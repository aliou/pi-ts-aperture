/**
 * Pi-specific bridge implementation for the MCP Apps host.
 *
 * This module adapts the generic `McpAppBridge` interface to Pi APIs:
 * - tools/call proxies into the active Aperture MCP session
 * - ui/message becomes a Pi user message via pi.sendUserMessage
 * - ui/open-link opens the URL in the system browser via pi.exec
 */

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { McpAppBridge } from "../../src/mcp-app/types";
import type { McpSession } from "../../src/mcp-client";

export function createMcpAppBridge(
  pi: ExtensionAPI,
  _ctx: ExtensionContext,
  getSession: () => McpSession | undefined,
): McpAppBridge {
  return {
    async callTool(name, args, signal) {
      const session = getSession();
      if (!session) {
        throw new Error("Connector session is not available");
      }
      return session.callTool(name, args, signal);
    },

    async sendMessage(content) {
      const normalized = normalizeUserMessage(content);
      pi.sendUserMessage(normalized, { deliverAs: "followUp" });
      return null;
    },

    async openLink(url) {
      await openExternalLink(pi, url);
      return null;
    },
  };
}

function normalizeUserMessage(
  content: unknown,
): string | (TextContent | ImageContent)[] {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content as (TextContent | ImageContent)[];
  return String(content);
}

async function openExternalLink(pi: ExtensionAPI, url: string): Promise<void> {
  const { command, args } = platformOpenCommand(url);
  try {
    await pi.exec(command, args);
  } catch {
    // Best-effort. The iframe cannot use the failure for anything meaningful.
  }
}

function platformOpenCommand(url: string): { command: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      return { command: "cmd", args: ["/c", "start", "", url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}
