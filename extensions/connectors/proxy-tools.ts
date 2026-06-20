/**
 * Connector proxy meta-tools: list, search, describe, and call.
 *
 * Instead of registering every connector tool as a Pi tool (high context cost),
 * we register four proxy tools. The model discovers connectors via list,
 * discovers tools via search, inspects schemas via describe, then executes
 * via call.
 */

import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolCallHeader } from "@aliou/pi-utils-ui";
import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions,
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
import type { ConnectorInfo } from "../../src/api/types";
import type { McpContentItem, McpSession, McpTool } from "../../src/mcp-client";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function truncateDescription(desc: string, max = 80): string {
  const flat = desc.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!flat || flat.length <= max) return flat;
  return `${flat.slice(0, max - 3)}...`;
}

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
  const line = `${prefix}- \`${key}\` (${typeStr}, ${reqStr})${desc ? `: ${desc}` : ""}`;

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

interface CallToolDetails {
  toolName: string;
  rawResult?: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

async function executeConnectorCall(
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
  const details: CallToolDetails = { toolName, rawResult: fullText };

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

// ---------------------------------------------------------------------------
// connector_list
// ---------------------------------------------------------------------------

interface ListDetails {
  connectors: ConnectorInfo[];
  counts: Map<string, number>;
}

export function createConnectorListTool(
  connectors: ConnectorInfo[],
  tools: McpTool[],
) {
  const counts = new Map<string, number>();
  for (const t of tools) {
    const idx = t.name.indexOf("_");
    const prefix = idx > 0 ? t.name.slice(0, idx) : "other";
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }

  return defineTool({
    name: "connector_list",
    label: "Connector List",
    description:
      "List all available Aperture connectors and their metadata. Use this to discover which connectors are configured and how many tools each exposes.",
    parameters: Type.Object({}),
    promptSnippet: "List available connectors",

    async execute() {
      if (connectors.length === 0) {
        return {
          content: [
            { type: "text", text: "No connectors are currently configured." },
          ],
          details: { connectors: [], counts },
        };
      }

      const lines: string[] = [];
      for (const c of connectors) {
        const toolCount = counts.get(c.id) ?? 0;
        const desc = truncateDescription(c.description || "(no description)");
        lines.push(
          `- **${c.provider || c.id}** (\`${c.id}\`): ${desc} — ${toolCount} tool${toolCount === 1 ? "" : "s"} — ${c.status || "unknown"}`,
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `${connectors.length} connector(s) available:\n\n${lines.join("\n")}`,
          },
        ],
        details: { connectors, counts },
      };
    },

    renderCall(_args, theme) {
      return new ToolCallHeader({ toolName: "Connector List" }, theme);
    },

    renderResult(
      result: AgentToolResult<ListDetails>,
      options: ToolRenderResultOptions,
      _theme: Theme,
    ) {
      const details = result.details;
      const mdTheme = getMarkdownTheme();

      if (!details || details.connectors.length === 0) {
        const text = result.content[0];
        const content = text?.type === "text" ? text.text : "No result";
        return new Text(content, 0, 0);
      }

      const lines: string[] = [];

      if (!options.expanded) {
        for (const c of details.connectors) {
          const toolCount = details.counts.get(c.id) ?? 0;
          const desc = truncateDescription(c.description || "(no description)");
          lines.push(
            `- **${c.provider || c.id}** (\`${c.id}\`): ${desc} — ${toolCount} tool${toolCount === 1 ? "" : "s"} — ${c.status || "unknown"}`,
          );
        }
      } else {
        lines.push("");
        for (const c of details.connectors) {
          const toolCount = details.counts.get(c.id) ?? 0;
          if (lines.length > 0) lines.push("");
          lines.push(`### ${c.provider || c.id} (\`${c.id}\`)`);
          if (c.description) {
            lines.push(c.description);
          }
          lines.push("");
          if (c.category) lines.push(`- **Category:** ${c.category}`);
          if (c.status) lines.push(`- **Status:** ${c.status}`);
          if (c.protocol) lines.push(`- **Protocol:** ${c.protocol}`);
          if (c.provider && c.provider !== c.id)
            lines.push(`- **Provider:** ${c.provider}`);
          if (c.auth_type) lines.push(`- **Auth:** \`${c.auth_type}\``);
          lines.push(`- **Tools:** ${toolCount}`);
        }
      }

      return new Markdown(lines.join("\n"), 0, 0, mdTheme);
    },
  });
}

// ---------------------------------------------------------------------------
// connector_tool_search
// ---------------------------------------------------------------------------

interface SearchDetails {
  query: string;
  connector?: string;
  limit: number;
  matches: number;
  groups: [string, McpTool[]][];
}

export function createConnectorToolSearchTool(
  tools: McpTool[],
  connectorIds: string[],
) {
  const knownIds = new Set(connectorIds.map((id) => id.toLowerCase()));

  return defineTool({
    name: "connector_tool_search",
    label: "Connector Tool Search",
    description:
      "Search for available tools from Aperture connectors by name or description. Use this when you need to find a tool to accomplish a task but don't know its exact name. Pass an empty query to list all tools.",
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
            "Filter to a specific connector, e.g. 'github' or 'aperture'",
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
              text: `No tools found${query ? ` matching "${params.query as string}"` : ""}${connector ? ` from connector "${connector}"` : ""}. Use connector_list to see available connectors.`,
            },
          ],
          details: { query, connector, limit, matches: 0, groups: [] },
        };
      }

      // Group by verified connector ID; unknown prefixes go to "other"
      const groups = new Map<string, McpTool[]>();
      for (const t of matches) {
        const idx = t.name.indexOf("_");
        const prefix = idx > 0 ? t.name.slice(0, idx) : t.name;
        const key = knownIds.has(prefix.toLowerCase()) ? prefix : "other";
        const list = groups.get(key) ?? [];
        list.push(t);
        groups.set(key, list);
      }

      const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
        if (a[0] === "other") return 1;
        if (b[0] === "other") return -1;
        return a[0].localeCompare(b[0]);
      });

      const lines: string[] = [];

      if (!connector) {
        // No connector filter: group by connector with headers
        for (const [prefix, list] of sortedGroups) {
          lines.push(`### ${prefix} (${list.length})`);
          for (const t of list) {
            const desc = truncateDescription(t.description ?? "", 100);
            lines.push(`- \`${t.name}\`: ${desc || "(no description)"}`);
          }
          lines.push("");
        }
      } else {
        // Connector filter applied: flat list
        for (const t of matches) {
          const desc = truncateDescription(t.description ?? "", 100);
          lines.push(`- \`${t.name}\`: ${desc || "(no description)"}`);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: lines.join("\n").trimEnd(),
          },
        ],
        details: {
          query,
          connector,
          limit,
          matches: matches.length,
          groups: sortedGroups,
        },
      };
    },

    renderCall(args, theme) {
      const query =
        args && typeof args === "object"
          ? String((args as Record<string, unknown>).query || "")
          : "";
      const connector =
        args && typeof args === "object"
          ? String((args as Record<string, unknown>).connector || "")
          : "";
      const limit =
        args && typeof args === "object"
          ? String((args as Record<string, unknown>).limit ?? "15")
          : "15";

      const optionArgs: Array<{
        label: string;
        value: string;
        tone?: "accent" | "muted";
      }> = [];
      if (connector) {
        optionArgs.push({
          label: "connector",
          value: connector,
          tone: "accent",
        });
      }
      optionArgs.push({ label: "limit", value: limit, tone: "muted" });

      return new ToolCallHeader(
        {
          toolName: "Connector Tool Search",
          mainArg: query
            ? `"${query.length > 40 ? `${query.slice(0, 37)}...` : query}"`
            : undefined,
          optionArgs,
        },
        theme,
      );
    },

    renderResult(
      result: AgentToolResult<SearchDetails>,
      options: ToolRenderResultOptions,
      _theme: Theme,
    ) {
      const details = result.details;
      const mdTheme = getMarkdownTheme();

      if (!details || details.matches === 0) {
        const text = result.content[0];
        const content = text?.type === "text" ? text.text : "No result";
        return new Text(content, 0, 0);
      }

      const lines: string[] = [];
      const COLLAPSED_COUNT = 5;

      if (!options.expanded) {
        // Flat list, first 5 across all groups
        let shown = 0;
        let remaining = 0;

        for (const [_prefix, list] of details.groups) {
          for (const t of list) {
            if (shown < COLLAPSED_COUNT) {
              const desc = truncateDescription(t.description ?? "", 60);
              lines.push(`- \`${t.name}\`: ${desc || "(no description)"}`);
              shown++;
            } else {
              remaining++;
            }
          }
        }

        if (remaining > 0) {
          lines.push("");
          lines.push(
            `*And ${remaining} more...* Use \`connector_tool_search\` with a query or expand to see all.`,
          );
        }
      } else {
        // Expanded: group by connector with headers
        lines.push("");
        for (const [prefix, list] of details.groups) {
          lines.push(`### ${prefix} (${list.length})`);
          for (const t of list) {
            const desc = truncateDescription(t.description ?? "", 100);
            lines.push(`- \`${t.name}\`: ${desc || "(no description)"}`);
          }
          lines.push("");
        }
      }

      return new Markdown(lines.join("\n"), 0, 0, mdTheme);
    },
  });
}

// ---------------------------------------------------------------------------
// connector_tool_describe
// ---------------------------------------------------------------------------

interface DescribeDetails {
  tool: McpTool;
}

export function createConnectorToolDescribeTool(tools: McpTool[]) {
  return defineTool({
    name: "connector_tool_describe",
    label: "Connector Tool Describe",
    description:
      "Get the full description and parameter schema for a specific connector tool. Call this before connector_tool_call to understand what arguments the tool expects.",
    parameters: Type.Object({
      tool: Type.String({
        description: "Name of the connector tool to describe",
      }),
    }),
    promptSnippet: "Describe a connector tool's parameters",

    async execute(_id, params) {
      const toolName = params.tool as string;
      const tool = tools.find((t) => t.name === toolName);

      if (!tool) {
        return {
          content: [
            {
              type: "text",
              text: `Tool "${toolName}" not found. Use connector_tool_search to find available tools.`,
            },
          ],
          details: {} as DescribeDetails,
        };
      }

      const schemaText =
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? formatJsonSchema(tool.inputSchema)
          : "(no parameters)";

      const text = [
        `### ${tool.name}`,
        tool.description || "(no description)",
        "",
        "**Parameters:**",
        "```",
        schemaText,
        "```",
      ].join("\n");

      return {
        content: [{ type: "text", text }],
        details: { tool },
      };
    },

    renderCall(args, theme) {
      const toolName =
        args && typeof args === "object"
          ? String((args as Record<string, unknown>).tool || "")
          : "";
      return new ToolCallHeader(
        {
          toolName: "Connector Tool Describe",
          mainArg: toolName || undefined,
        },
        theme,
      );
    },

    renderResult(
      result: AgentToolResult<DescribeDetails>,
      options: ToolRenderResultOptions,
      _theme: Theme,
    ) {
      const details = result.details;
      const mdTheme = getMarkdownTheme();

      if (!details) {
        const text = result.content[0];
        const content = text?.type === "text" ? text.text : "No result";
        return new Text(content, 0, 0);
      }

      const tool = details.tool;
      const schemaText =
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? formatJsonSchema(tool.inputSchema)
          : "(no parameters)";

      const lines: string[] = [];

      if (!options.expanded) {
        lines.push(`### ${tool.name}`);
        if (tool.description) {
          lines.push(truncateDescription(tool.description, 120));
        }
        lines.push("");
        lines.push("**Parameters:**");
        const paramLines = schemaText.split("\n");
        const shown = paramLines.slice(0, 4);
        for (const line of shown) {
          lines.push(line);
        }
        if (paramLines.length > 4) {
          lines.push(`*... and ${paramLines.length - 4} more*  `);
        }
      } else {
        lines.push("");
        lines.push(`### ${tool.name}`);
        if (tool.description) {
          lines.push(tool.description);
        }
        lines.push("");
        lines.push("**Parameters:**");
        lines.push("```");
        lines.push(schemaText);
        lines.push("```");
      }

      return new Markdown(lines.join("\n"), 0, 0, mdTheme);
    },
  });
}

// ---------------------------------------------------------------------------
// connector_tool_call
// ---------------------------------------------------------------------------

export function createConnectorToolCallTool(
  tools: McpTool[],
  getSession: () => McpSession | undefined,
) {
  return defineTool({
    name: "connector_tool_call",
    label: "Connector Tool Call",
    description:
      "Execute a connector tool by name with JSON arguments. Call connector_tool_describe first to see the required parameters. The args field must be a valid JSON object string matching the tool's schema.",
    parameters: Type.Object({
      tool: Type.String({
        description: "Name of the connector tool to execute",
      }),
      args: Type.Optional(
        Type.String({
          description:
            "Arguments as a JSON object string. Call connector_tool_describe first to see the expected schema. Omit if the tool takes no arguments.",
        }),
      ),
    }),
    promptSnippet: "Call a connector tool",

    async execute(_id, params, signal, onUpdate) {
      const toolName = params.tool as string;
      const argsJson = (params.args as string | undefined) || "{}";

      const toolMeta = tools.find((t) => t.name === toolName);
      if (!toolMeta) {
        return {
          content: [
            {
              type: "text",
              text: `Tool "${toolName}" not found. Use connector_tool_search to find available tools.`,
            },
          ],
          details: {} as CallToolDetails,
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
              text: `Invalid args JSON: ${e instanceof Error ? e.message : String(e)}. Use connector_tool_describe("${toolName}") to see the expected schema.`,
            },
          ],
          details: {} as CallToolDetails,
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
              text: "Connector session is not available. The connectors feature may be disabled or the Aperture host unreachable.",
            },
          ],
          details: {} as CallToolDetails,
        };
      }

      return executeConnectorCall(toolName, args, session, signal);
    },

    renderCall(args, theme) {
      const toolName =
        args && typeof args === "object"
          ? String((args as Record<string, unknown>).tool || "")
          : "";
      return new ToolCallHeader(
        {
          toolName: toolName || "Connector Tool Call",
          mainArg: "",
        },
        theme,
      );
    },

    renderResult(
      result: AgentToolResult<unknown>,
      options: ToolRenderResultOptions,
      _theme: Theme,
    ) {
      const details = result.details as CallToolDetails | undefined;
      const mdTheme = getMarkdownTheme();

      if (options.isPartial) {
        const toolName = details?.toolName ?? "connector";
        return new Text(`Calling ${toolName}...`, 0, 0);
      }

      const textBlock = result.content.find((c) => c.type === "text");
      const modelText = textBlock?.type === "text" ? textBlock.text : "";
      const rawResult = details?.rawResult ?? modelText;

      if (!modelText && !details?.rawResult) {
        return new Text("Connector call failed", 0, 0);
      }

      let displayText = rawResult;
      let isJson = false;
      try {
        const parsed = JSON.parse(rawResult);
        displayText = JSON.stringify(parsed, null, 2);
        isJson = true;
      } catch {
        // not JSON, keep raw
      }

      const lines: string[] = [];

      if (!options.expanded) {
        const previewLines = displayText.split("\n").slice(0, 3);
        let preview = previewLines.join("\n");
        const hasMore =
          displayText.split("\n").length > 3 || displayText.length > 120;
        if (preview.length > 120) {
          preview = `${preview.slice(0, 117)}...`;
        } else if (hasMore) {
          preview += "...";
        }
        lines.push(preview);
      } else {
        lines.push("");
        if (isJson) {
          lines.push("```json");
          lines.push(displayText);
          lines.push("```");
        } else {
          lines.push(displayText);
        }
      }

      // Footer info as markdown text
      const warnings: string[] = [];
      if (details?.fullOutputPath) {
        warnings.push(`Full output: \`${details.fullOutputPath}\``);
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
      if (warnings.length > 0) {
        lines.push("");
        lines.push(`*${warnings.join(". ")}*`);
      }

      return new Markdown(lines.join("\n"), 0, 0, mdTheme);
    },
  });
}
