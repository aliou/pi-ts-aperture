/**
 * MCP proxy meta-tools: search, describe, and call.
 *
 * Instead of registering every MCP tool as a Pi tool (high context cost),
 * we register three proxy tools. The model discovers tools via search,
 * inspects schemas via describe, then executes via call.
 */

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  TruncationResult,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  defineTool,
  formatSize,
  getMarkdownTheme,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { McpContentItem, McpSession, McpTool } from "../../src/mcp-client";

// ---------------------------------------------------------------------------
// Schema formatting helpers for mcp_describe
// ---------------------------------------------------------------------------

function formatProperty(
  key: string,
  schema: unknown,
  required: boolean,
  indent = 0,
): string {
  const s = schema as Record<string, unknown>;
  const type = (s.type as string) || "any";
  const desc = (s.description as string) || "";
  const reqStr = required ? "required" : "optional";

  let typeStr = type;

  if (s.enum && Array.isArray(s.enum) && s.enum.length > 0) {
    typeStr = `enum(${s.enum.map((v) => JSON.stringify(v)).join("|")})`;
  }

  if (type === "array" && s.items) {
    const itemType =
      ((s.items as Record<string, unknown>).type as string) || "any";
    typeStr = `array<${itemType}>`;
  }

  if (type === "object" && s.properties) {
    typeStr = "object";
  }

  const prefix = "  ".repeat(indent);
  const line = `${prefix}- ${key} (${typeStr}, ${reqStr})${desc ? `: ${desc}` : ""}`;

  if (type === "object" && s.properties) {
    const props = s.properties as Record<string, unknown>;
    const req = new Set((s.required as string[]) || []);
    const nested = Object.entries(props).map(([k, v]) =>
      formatProperty(k, v, req.has(k), indent + 1),
    );
    return [line, ...nested].join("\n");
  }

  return line;
}

function formatJsonSchema(schema: unknown): string {
  const s = schema as Record<string, unknown>;
  const props = s.properties as Record<string, unknown> | undefined;
  if (!props || Object.keys(props).length === 0) return "(no parameters)";

  const required = new Set((s.required as string[]) || []);
  return Object.entries(props)
    .map(([key, prop]) => formatProperty(key, prop, required.has(key)))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Truncation / rendering helpers shared with mcp_call
// ---------------------------------------------------------------------------

interface CallToolDetails {
  rawResult?: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

async function executeMcpCall(
  toolName: string,
  args: Record<string, unknown>,
  session: McpSession,
  signal?: AbortSignal,
): Promise<AgentToolResult<CallToolDetails>> {
  const result = await session.callTool(toolName, args, signal);

  const textParts = result.content
    .filter(
      (c): c is McpContentItem & { text: string } => typeof c.text === "string",
    )
    .map((c) => c.text);

  const fullText = textParts.join("\n\n");
  const truncation = truncateHead(fullText);

  let outputText = fullText;
  const details: CallToolDetails = { rawResult: fullText };

  if (truncation.truncated) {
    let tempPath: string | undefined;
    try {
      const tempId = randomBytes(8).toString("hex");
      tempPath = join(tmpdir(), `pi-aperture-connector-${tempId}.json`);
      await writeFile(tempPath, fullText, "utf-8");
      details.fullOutputPath = tempPath;
    } catch {
      // temp file unavailable, proceed without it
    }

    details.truncation = truncation;

    if (truncation.firstLineExceedsLimit) {
      const firstLineSize = formatSize(truncation.totalBytes);
      outputText = `[Output is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit${tempPath ? `. Full output: ${tempPath}` : ""}]`;
    } else {
      const endLine = truncation.outputLines;
      const base = `[Showing lines 1-${endLine} of ${truncation.totalLines}`;
      const limit =
        truncation.truncatedBy === "bytes"
          ? ` (${formatSize(DEFAULT_MAX_BYTES)} limit)`
          : "";
      const full = tempPath ? `. Full output: ${tempPath}` : "";
      outputText = `${truncation.content}\n\n${base}${limit}${full}]`;
    }
  }

  return {
    content: [{ type: "text", text: outputText || "(no text output)" }],
    details,
  };
}

// NOTE: renderResult is inlined below to avoid Theme type mismatches.

// ---------------------------------------------------------------------------
// mcp_search
// ---------------------------------------------------------------------------

export function createMcpSearchTool(tools: McpTool[]) {
  return defineTool({
    name: "mcp_search",
    label: "MCP Search",
    description:
      "Search for available MCP tools from Aperture connectors by name or description. Use this when you need to find a tool to accomplish a task but don't know its exact name. Pass an empty query to list all tools.",
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description:
            "Search query to match tool names or descriptions. Use * or leave empty to list all.",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum results to return",
          default: 15,
        }),
      ),
      connector: Type.Optional(
        Type.String({
          description:
            "Filter to a specific connector prefix, e.g. 'github' or 'aperture'",
        }),
      ),
    }),
    promptSnippet: "Search available connector tools",
    async execute(_id, params) {
      const query = ((params.query as string) || "").trim().toLowerCase();
      const limit = (params.limit as number | undefined) ?? 15;
      const connector = (params.connector as string | undefined)?.trim();

      let matches = tools;

      if (connector) {
        const prefix = `${connector.toLowerCase()}_`;
        matches = matches.filter((t) =>
          t.name.toLowerCase().startsWith(prefix),
        );
      }

      if (query && query !== "*") {
        matches = matches.filter(
          (t) =>
            t.name.toLowerCase().includes(query) ||
            (t.description ?? "").toLowerCase().includes(query),
        );
      }

      matches = matches.slice(0, limit);

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No tools found${query ? ` matching "${params.query as string}"` : ""}${connector ? ` from connector "${connector}"` : ""}.`,
            },
          ],
          details: {},
        };
      }

      const lines = matches.map(
        (t, i) =>
          `${i + 1}. ${t.name} — ${t.description ?? "(no description)"}`,
      );

      return {
        content: [
          {
            type: "text",
            text: `Found ${matches.length} tool(s):\n\n${lines.join("\n")}`,
          },
        ],
        details: {},
      };
    },
  });
}

// ---------------------------------------------------------------------------
// mcp_describe
// ---------------------------------------------------------------------------

export function createMcpDescribeTool(tools: McpTool[]) {
  return defineTool({
    name: "mcp_describe",
    label: "MCP Describe",
    description:
      "Get the full description and parameter schema for a specific MCP tool. Call this before mcp_call to understand what arguments the tool expects.",
    parameters: Type.Object({
      tool: Type.String({
        description: "Name of the MCP tool to describe",
      }),
    }),
    promptSnippet: "Describe an MCP tool's parameters",
    async execute(_id, params) {
      const toolName = params.tool as string;
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        return {
          content: [
            {
              type: "text",
              text: `Tool "${toolName}" not found. Use mcp_search to find available tools.`,
            },
          ],
          details: {},
        };
      }

      const schemaText =
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? formatJsonSchema(tool.inputSchema)
          : "(no parameters)";

      const text = [
        `Tool: ${tool.name}`,
        `Description: ${tool.description ?? "(no description)"}`,
        "",
        `Parameters:\n${schemaText}`,
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        details: {},
      };
    },
  });
}

// ---------------------------------------------------------------------------
// mcp_call
// ---------------------------------------------------------------------------

export function createMcpCallTool(
  tools: McpTool[],
  getSession: () => McpSession | undefined,
) {
  return defineTool({
    name: "mcp_call",
    label: "MCP Call",
    description:
      "Execute an MCP tool by name with JSON arguments. Call mcp_describe first to see the required parameters. The args field must be a valid JSON object string matching the tool's schema.",
    parameters: Type.Object({
      tool: Type.String({
        description: "Name of the MCP tool to execute",
      }),
      args: Type.Optional(
        Type.String({
          description:
            "Arguments as a JSON object string. Call mcp_describe first to see the expected schema. Omit if the tool takes no arguments.",
        }),
      ),
    }),
    promptSnippet: "Call an MCP connector tool",

    async execute(_id, params, signal, onUpdate) {
      const toolName = params.tool as string;
      const argsJson = (params.args as string | undefined) || "{}";

      const toolMeta = tools.find((t) => t.name === toolName);
      if (!toolMeta) {
        return {
          content: [
            {
              type: "text",
              text: `Tool "${toolName}" not found. Use mcp_search to find available tools.`,
            },
          ],
          details: {},
        };
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsJson);
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          throw new Error(
            "args must be a JSON object, not an array or primitive",
          );
        }
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `Invalid args JSON: ${e instanceof Error ? e.message : String(e)}. Use mcp_describe("${toolName}") to see the expected schema.`,
            },
          ],
          details: {},
        };
      }

      onUpdate?.({
        content: [{ type: "text", text: `Calling ${toolName}...` }],
        details: {},
      });

      const session = getSession();
      if (!session) {
        return {
          content: [
            {
              type: "text",
              text: "MCP session is not available. The connectors feature may be disabled or the Aperture host unreachable.",
            },
          ],
          details: {},
        };
      }

      return executeMcpCall(toolName, args, session, signal);
    },

    renderCall(args, theme) {
      const toolName =
        args && typeof args === "object"
          ? (args as Record<string, unknown>).tool
          : "";
      return new ToolCallHeader(
        { toolName: "MCP Call", mainArg: String(toolName ?? "") },
        theme,
      );
    },

    renderResult(result, options, theme) {
      if (options.isPartial) {
        return new Text(theme.fg("muted", "MCP Call: calling..."), 0, 0);
      }

      const details = (result as AgentToolResult<CallToolDetails>).details as
        | CallToolDetails
        | undefined;
      const textBlock = result.content.find((c) => c.type === "text");
      const modelText = textBlock?.type === "text" ? textBlock.text : "";
      const rawResult = details?.rawResult ?? modelText;

      if (!modelText && !details?.rawResult) {
        return new Text(theme.fg("error", "MCP Call failed"), 0, 0);
      }

      let displayText = rawResult;
      try {
        const parsed = JSON.parse(rawResult);
        displayText = JSON.stringify(parsed, null, 2);
      } catch {
        // not JSON, keep raw
      }

      if (!options.expanded) {
        const lines = displayText.split("\n");
        let preview = lines.slice(0, 3).join("\n");
        const hasMore = lines.length > 3 || displayText.length > 120;
        if (preview.length > 120) {
          preview = `${preview.slice(0, 117)}...`;
        } else if (hasMore) {
          preview += "...";
        }
        return new Text(theme.fg("toolOutput", preview), 0, 0);
      }

      const markdownTheme = getMarkdownTheme();
      const codeBlock = `\`\`\`json\n${displayText}\n\`\`\``;

      const warnings: string[] = [];
      if (details?.fullOutputPath) {
        warnings.push(`Full output: ${details.fullOutputPath}`);
      }
      if (details?.truncation?.truncated) {
        const t = details.truncation;
        if (t.truncatedBy === "lines") {
          warnings.push(
            `Truncated: showing ${t.outputLines} of ${t.totalLines} lines`,
          );
        } else {
          warnings.push(
            `Truncated: ${t.outputLines} lines shown (${formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
          );
        }
      }

      const fullRender =
        warnings.length > 0
          ? `${codeBlock}\n\n${theme.fg("warning", `[${warnings.join(". ")}]`)}`
          : codeBlock;

      return new Markdown(fullRender, 0, 0, markdownTheme);
    },
  });
}
