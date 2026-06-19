/**
 * Convert discovered MCP tools into Pi defineTool registrations.
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
import type { McpContentItem, McpSession } from "../../src/mcp-client";
import { jsonSchemaToTypeBox } from "./schema-converter";

function buildLabel(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function truncateDescription(description: string, max = 500): string {
  if (description.length <= max) return description;
  return `${description.slice(0, max)}...`;
}

interface ConnectorToolDetails {
  rawResult?: string;
  truncation?: TruncationResult;
  fullOutputPath?: string;
}

export function createPiToolFromMcp(
  mcpTool: {
    name: string;
    description?: string;
    inputSchema?: unknown;
  },
  session: McpSession,
) {
  const toolName = mcpTool.name;
  const label = buildLabel(mcpTool.name);
  const description = truncateDescription(
    mcpTool.description ?? `MCP tool: ${mcpTool.name}`,
  );

  const parameters = mcpTool.inputSchema
    ? jsonSchemaToTypeBox(mcpTool.inputSchema)
    : Type.Object({});

  return defineTool({
    name: toolName,
    label,
    description,
    parameters,
    promptSnippet: description.slice(0, 120),

    async execute(
      _toolCallId,
      params,
      signal,
      onUpdate,
      _ctx,
    ): Promise<AgentToolResult<ConnectorToolDetails>> {
      onUpdate?.({
        content: [{ type: "text", text: `Calling ${mcpTool.name}...` }],
        details: {},
      });

      const result = await session.callTool(
        mcpTool.name,
        params as Record<string, unknown>,
        signal,
      );

      const textParts = result.content
        .filter(
          (c): c is McpContentItem & { text: string } =>
            typeof c.text === "string",
        )
        .map((c) => c.text);

      const fullText = textParts.join("\n\n");
      const truncation = truncateHead(fullText);

      let outputText = fullText;
      const details: ConnectorToolDetails = { rawResult: fullText };

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
    },

    renderCall(args, theme) {
      const mainArg =
        args && typeof args === "object"
          ? Object.entries(args as Record<string, unknown>)
              .slice(0, 1)
              .map(([k, v]) => `${k}=${String(v).slice(0, 40)}`)
              .join(", ")
          : "";
      return new ToolCallHeader(
        {
          toolName: label,
          mainArg: mainArg || mcpTool.name,
        },
        theme,
      );
    },

    renderResult(result, options, theme) {
      if (options.isPartial) {
        return new Text(theme.fg("muted", `${label}: calling...`), 0, 0);
      }

      const details = result.details as ConnectorToolDetails | undefined;
      const textBlock = result.content.find((c) => c.type === "text");
      const modelText = textBlock?.type === "text" ? textBlock.text : "";

      if (!modelText && !details?.rawResult) {
        return new Text(theme.fg("error", `${label} failed`), 0, 0);
      }

      // Use raw result for rendering; model text may include truncation notices.
      const rawResult = details?.rawResult ?? modelText;

      // Prettify JSON if possible.
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

      // Expanded: markdown code block with JSON.
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
