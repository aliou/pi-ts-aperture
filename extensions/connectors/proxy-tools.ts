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
import { ToolBody, ToolCallHeader, ToolFooter } from "@aliou/pi-utils-ui";
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
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { ConnectorInfo } from "../../src/api/types";
import type { McpContentItem, McpSession, McpTool } from "../../src/mcp-client";

// ---------------------------------------------------------------------------
// Schema formatting helpers for connector_tool_describe
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
// Truncation / rendering helpers shared with connector_tool_call
// ---------------------------------------------------------------------------

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

      const lines = connectors.map((c) => {
        const toolCount = counts.get(c.id) ?? 0;
        const parts = [
          `${c.id}: ${c.description || "(no description)"}`,
          c.category ? `  category: ${c.category}` : "",
          c.status ? `  status: ${c.status}` : "",
          c.protocol ? `  protocol: ${c.protocol}` : "",
          c.provider ? `  provider: ${c.provider}` : "",
          c.auth_type ? `  auth: ${c.auth_type}` : "",
          `  tools: ${toolCount}`,
        ];
        return parts.filter(Boolean).join("\n");
      });

      return {
        content: [
          {
            type: "text",
            text: `${connectors.length} connector(s) available:\n\n${lines.join("\n\n")}`,
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
      theme: Theme,
    ) {
      const details = result.details;
      if (!details || details.connectors.length === 0) {
        const text = result.content[0];
        const content = text?.type === "text" ? text.text : "No result";
        return new Text(theme.fg("muted", content), 0, 0);
      }

      const fields: Array<
        { label: string; value: string; showCollapsed?: boolean } | Text
      > = [];
      const lines: string[] = [];

      for (const c of details.connectors) {
        const toolCount = details.counts.get(c.id) ?? 0;
        const statusColor =
          c.status === "ready"
            ? "success"
            : c.status === "error"
              ? "error"
              : "warning";

        if (!options.expanded) {
          lines.push(
            `  ${theme.fg("success", "•")} ${theme.fg("accent", c.id)} ${theme.fg("muted", "-")} ${theme.fg("toolOutput", c.description || "(no description)")} ${theme.fg("muted", "-")} ${theme.fg(statusColor, `${toolCount} tool${toolCount === 1 ? "" : "s"}`)}`,
          );
        } else {
          if (lines.length > 0) lines.push("");
          lines.push(
            `${theme.fg("muted", "┌─")} ${theme.fg("accent", c.id)} ${theme.fg("muted", "•")} ${theme.fg(statusColor, c.status || "unknown")}`,
          );
          if (c.description) {
            lines.push(
              `${theme.fg("muted", "│")} ${theme.fg("dim", c.description)}`,
            );
          }
          if (c.category) {
            lines.push(
              `${theme.fg("muted", "│")} ${theme.fg("muted", "category:")} ${theme.fg("dim", c.category)}`,
            );
          }
          if (c.protocol) {
            lines.push(
              `${theme.fg("muted", "│")} ${theme.fg("muted", "protocol:")} ${theme.fg("dim", c.protocol)}`,
            );
          }
          if (c.provider) {
            lines.push(
              `${theme.fg("muted", "│")} ${theme.fg("muted", "provider:")} ${theme.fg("dim", c.provider)}`,
            );
          }
          if (c.auth_type) {
            lines.push(
              `${theme.fg("muted", "│")} ${theme.fg("muted", "auth:")} ${theme.fg("dim", c.auth_type)}`,
            );
          }
          lines.push(
            `${theme.fg("muted", "│")} ${theme.fg("muted", "tools:")} ${theme.fg("toolOutput", `${toolCount}`)}`,
          );
          lines.push(theme.fg("muted", "└─"));
        }
      }

      if (lines.length > 0) {
        fields.push(new Text(lines.join("\n"), 0, 0));
      }

      const footer = new ToolFooter(theme, {
        items: [
          {
            label: "connectors",
            value: String(details.connectors.length),
            tone: "success",
          },
        ],
      });

      return new ToolBody({ fields, footer }, options, theme);
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

      const header = `Found ${matches.length} tool(s) from ${sortedGroups.filter(([k]) => k !== "other").length} connector(s): ${sortedGroups
        .filter(([k]) => k !== "other")
        .map(([k]) => k)
        .join(
          ", ",
        )}${groups.has("other") ? ` + ${groups.get("other")?.length ?? 0} unclassified` : ""}`;

      const lines: string[] = [header, ""];
      for (const [prefix, list] of sortedGroups) {
        lines.push(`${prefix}:`);
        for (const t of list) {
          lines.push(`  - ${t.name}: ${t.description ?? "(no description)"}`);
        }
        lines.push("");
      }

      return {
        content: [{ type: "text", text: lines.join("\n").trimEnd() }],
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
        tone?: "accent" | "muted" | "dim";
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
      theme: Theme,
    ) {
      const details = result.details;
      if (!details || details.matches === 0) {
        const text = result.content[0];
        const content = text?.type === "text" ? text.text : "No result";
        return new Text(theme.fg("muted", content), 0, 0);
      }

      const fields: Array<
        { label: string; value: string; showCollapsed?: boolean } | Text
      > = [];
      const lines: string[] = [];

      for (const [prefix, list] of details.groups) {
        const isOther = prefix === "other";
        const prefixColor = isOther ? "warning" : "accent";

        if (!options.expanded) {
          lines.push(
            `${theme.fg(prefixColor, `${prefix}:`)} ${theme.fg("muted", `${list.length} tool${list.length === 1 ? "" : "s"}`)}`,
          );
          for (const t of list) {
            const desc = t.description ?? "";
            const shortDesc =
              desc.length > 60 ? `${desc.slice(0, 57)}...` : desc;
            lines.push(
              `  ${theme.fg("success", "•")} ${theme.fg("toolOutput", t.name)} ${theme.fg("muted", shortDesc || "(no description)")}`,
            );
          }
        } else {
          if (lines.length > 0) lines.push("");
          lines.push(
            `${theme.fg("muted", "┌─")} ${theme.fg(prefixColor, prefix)} ${theme.fg("muted", `• ${list.length} tool${list.length === 1 ? "" : "s"}`)}`,
          );
          for (const t of list) {
            lines.push(
              `${theme.fg("muted", "│")} ${theme.fg("success", "•")} ${theme.fg("toolOutput", t.name)}`,
            );
            if (t.description) {
              lines.push(
                `${theme.fg("muted", "│")}   ${theme.fg("dim", t.description)}`,
              );
            }
          }
          lines.push(theme.fg("muted", "└─"));
        }
      }

      if (lines.length > 0) {
        fields.push(new Text(lines.join("\n"), 0, 0));
      }

      const footerItems: Array<{
        label: string;
        value: string;
        tone?: "success" | "muted" | "accent" | "warning";
      }> = [
        {
          label: "matches",
          value: String(details.matches),
          tone: "success",
        },
        { label: "limit", value: String(details.limit), tone: "muted" },
      ];
      if (details.connector) {
        footerItems.push({
          label: "connector",
          value: details.connector,
          tone: "accent",
        });
      }

      const footer = new ToolFooter(theme, { items: footerItems });

      return new ToolBody({ fields, footer }, options, theme);
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
        `Tool: ${tool.name}`,
        `Description: ${tool.description ?? "(no description)"}`,
        "",
        `Parameters:\n${schemaText}`,
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
      theme: Theme,
    ) {
      const details = result.details;
      if (!details) {
        const text = result.content[0];
        const content = text?.type === "text" ? text.text : "No result";
        return new Text(theme.fg("error", content), 0, 0);
      }

      const tool = details.tool;
      const schemaText =
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? formatJsonSchema(tool.inputSchema)
          : "(no parameters)";

      const fields: Array<
        { label: string; value: string; showCollapsed?: boolean } | Text
      > = [];
      const lines: string[] = [];

      if (!options.expanded) {
        lines.push(
          `${theme.fg("accent", tool.name)} ${theme.fg("muted", tool.description ? `— ${tool.description.length > 80 ? `${tool.description.slice(0, 77)}...` : tool.description}` : "")}`,
        );
        lines.push("");
        lines.push(theme.fg("muted", "Parameters:"));
        const paramLines = schemaText.split("\n").slice(0, 4);
        for (const line of paramLines) {
          lines.push(`  ${theme.fg("dim", line)}`);
        }
        if (schemaText.split("\n").length > 4) {
          lines.push(
            `  ${theme.fg("muted", `... and ${schemaText.split("\n").length - 4} more`)}`,
          );
        }
      } else {
        lines.push(`${theme.fg("accent", tool.name)}`);
        if (tool.description) {
          lines.push(theme.fg("dim", tool.description));
        }
        lines.push("");
        lines.push(theme.fg("muted", "Parameters:"));
        for (const line of schemaText.split("\n")) {
          lines.push(theme.fg("dim", line));
        }
      }

      fields.push(new Text(lines.join("\n"), 0, 0));

      const paramCount =
        tool.inputSchema &&
        typeof tool.inputSchema === "object" &&
        (tool.inputSchema as Record<string, unknown>).properties
          ? Object.keys(
              (tool.inputSchema as Record<string, unknown>)
                .properties as Record<string, unknown>,
            ).length
          : 0;

      const footer = new ToolFooter(theme, {
        items: [
          { label: "params", value: String(paramCount), tone: "success" },
        ],
      });

      return new ToolBody({ fields, footer }, options, theme);
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
      theme: Theme,
    ) {
      const details = result.details as CallToolDetails | undefined;

      if (options.isPartial) {
        const toolName = details?.toolName ?? "connector";
        return new Text(theme.fg("muted", `Calling ${toolName}...`), 0, 0);
      }

      const textBlock = result.content.find((c) => c.type === "text");
      const modelText = textBlock?.type === "text" ? textBlock.text : "";
      const rawResult = details?.rawResult ?? modelText;

      if (!modelText && !details?.rawResult) {
        return new Text(theme.fg("error", "Connector call failed"), 0, 0);
      }

      let displayText = rawResult;
      try {
        const parsed = JSON.parse(rawResult);
        displayText = JSON.stringify(parsed, null, 2);
      } catch {
        // not JSON, keep raw
      }

      const fields: Array<
        { label: string; value: string; showCollapsed?: boolean } | Text
      > = [];

      if (!options.expanded) {
        const lines = displayText.split("\n");
        let preview = lines.slice(0, 3).join("\n");
        const hasMore = lines.length > 3 || displayText.length > 120;
        if (preview.length > 120) {
          preview = `${preview.slice(0, 117)}...`;
        } else if (hasMore) {
          preview += "...";
        }
        fields.push({
          label: "",
          value: theme.fg("toolOutput", preview),
          showCollapsed: true,
        });
      } else {
        const codeBlock = `\`\`\`json\n${displayText}\n\`\`\``;
        fields.push(new Text(codeBlock, 0, 0));
      }

      const footerItems: Array<{
        label: string;
        value: string;
        tone?: "muted" | "warning" | "error" | "success";
      }> = [];

      if (details?.fullOutputPath) {
        footerItems.push({
          label: "full output",
          value: details.fullOutputPath,
          tone: "muted",
        });
      }
      if (details?.truncation?.truncated) {
        const t = details.truncation;
        if (t.truncatedBy === "lines") {
          footerItems.push({
            label: "truncated",
            value: `${t.outputLines} of ${t.totalLines} lines`,
            tone: "warning",
          });
        } else {
          footerItems.push({
            label: "truncated",
            value: `${t.outputLines} lines (${formatSize(t.maxBytes ?? DEFAULT_MAX_BYTES)} limit)`,
            tone: "warning",
          });
        }
      }

      const footer =
        footerItems.length > 0
          ? new ToolFooter(theme, { items: footerItems })
          : undefined;

      return new ToolBody({ fields, footer }, options, theme);
    },
  });
}
