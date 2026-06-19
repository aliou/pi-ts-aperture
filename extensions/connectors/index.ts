/**
 * Dynamic MCP tool registration from Aperture connectors.
 *
 * Discovers tools via Aperture's /v1/mcp endpoint and registers each
 * as a Pi tool so models can use them natively.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { createMcpSession, type McpSession } from "../../src/mcp-client";
import { configLoader } from "../../src/shared/config/loader";
import {
  APERTURE_FEATURE_REGISTER_EVENT,
  APERTURE_FEATURE_REQUEST_EVENT,
  createFeatureRegisterPayload,
} from "../../src/shared/events";
import { createPiToolFromMcp } from "./tool-factory";

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
    let session: McpSession;
    try {
      session = await createMcpSession(baseUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`[connectors] MCP session failed: ${message}`, "error");
      return;
    }

    let tools: { name: string; description?: string; inputSchema?: unknown }[];
    try {
      tools = await session.listTools();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`[connectors] MCP tools/list failed: ${message}`, "error");
      return;
    }

    for (const tool of tools) {
      pi.registerTool(createPiToolFromMcp(tool, session));
    }
  });
}
