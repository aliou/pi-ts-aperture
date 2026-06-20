/**
 * Dynamic MCP tool registration from Aperture connectors.
 *
 * Discovers tools via Aperture's /v1/mcp endpoint and registers three
 * proxy meta-tools (search, describe, call) so models can discover and
 * invoke MCP tools without inflating the system prompt with individual
 * tool definitions.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  createMcpSession,
  type McpSession,
  type McpTool,
} from "../../src/mcp-client";
import { configLoader } from "../../src/shared/config/loader";
import {
  APERTURE_FEATURE_REGISTER_EVENT,
  APERTURE_FEATURE_REQUEST_EVENT,
  createFeatureRegisterPayload,
} from "../../src/shared/events";
import {
  createMcpCallTool,
  createMcpDescribeTool,
  createMcpSearchTool,
} from "./proxy-tools";

// Module-level state — refreshed on each session_start
let cachedTools: McpTool[] = [];
let mcpSession: McpSession | undefined;

export default async function apertureConnectors(
  pi: ExtensionAPI,
): Promise<void> {
  await configLoader.load();
  const config = configLoader.getConfig();

  if (!config.features.connectors) {
    return;
  }

  const baseUrl = config.baseUrl;
  if (!baseUrl) {
    return;
  }

  pi.events.on(APERTURE_FEATURE_REQUEST_EVENT, () => {
    pi.events.emit(
      APERTURE_FEATURE_REGISTER_EVENT,
      createFeatureRegisterPayload("connectors"),
    );
  });

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    try {
      mcpSession = await createMcpSession(baseUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`[connectors] MCP session failed: ${message}`, "error");
      return;
    }

    try {
      cachedTools = await mcpSession.listTools();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`[connectors] MCP tools/list failed: ${message}`, "error");
      return;
    }

    pi.registerTool(createMcpSearchTool(cachedTools));
    pi.registerTool(createMcpDescribeTool(cachedTools));
    pi.registerTool(createMcpCallTool(cachedTools, () => mcpSession));
  });
}
