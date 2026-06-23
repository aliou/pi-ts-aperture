/**
 * Connector proxy meta-tools for Aperture.
 *
 * Discovers tools via Aperture's /v1/mcp endpoint and registers four
 * proxy meta-tools (list, search, describe, call) so models can discover
 * and invoke connector tools without inflating the system prompt with
 * individual tool definitions.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { ApertureClient } from "../../src/api/client";
import type { ConnectorInfo } from "../../src/api/types";
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
  createConnectorListTool,
  createConnectorToolCallTool,
  createConnectorToolDescribeTool,
  createConnectorToolSearchTool,
  createStandaloneConnectorTool,
} from "./proxy-tools";

// Module-level state — refreshed on each session_start
let cachedTools: McpTool[] = [];
let cachedConnectors: ConnectorInfo[] = [];
let mcpSession: McpSession | undefined;

export default async function apertureConnectors(
  pi: ExtensionAPI,
): Promise<void> {
  await configLoader.load();
  const config = configLoader.getConfig();

  if (!config.connectors.enabled) {
    return;
  }

  const baseUrl = config.baseUrl;
  if (!baseUrl) {
    return;
  }

  const registerDiscoveryTools = config.connectors.discoveryTools;

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
      ctx.ui.notify(
        `[connectors] connector session failed: ${message}`,
        "error",
      );
      return;
    }

    try {
      cachedTools = await mcpSession.listTools();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(
        `[connectors] connector tools/list failed: ${message}`,
        "error",
      );
      return;
    }

    try {
      const client = new ApertureClient(baseUrl);
      cachedConnectors = await client.connectors();
    } catch {
      // Fall back to empty list; search will group everything under "other"
      cachedConnectors = [];
    }

    // Only surface connectors that actually expose tools
    const toolCounts = new Map<string, number>();
    for (const t of cachedTools) {
      const idx = t.name.indexOf("_");
      const prefix = idx > 0 ? t.name.slice(0, idx) : "other";
      toolCounts.set(prefix, (toolCounts.get(prefix) ?? 0) + 1);
    }
    cachedConnectors = cachedConnectors.filter(
      (c) => (toolCounts.get(c.id) ?? 0) > 0,
    );

    const connectorIds = cachedConnectors.map((c) => c.id);

    // Split pinned tools (registered as first-class Pi tools) from the rest
    // (reachable through the proxy meta-tools). Pinned entries whose
    // `toolName` no longer exists on the gateway are silently dropped here.
    // Matching is by `toolName`; `connectorId` is stored only for
    // traceability.
    const pinnedNames = new Set(
      config.connectors.pinnedTools.map((p) => p.toolName),
    );
    const pinnedTools = pinnedNames.size
      ? cachedTools.filter((t) => pinnedNames.has(t.name))
      : [];
    const proxiedTools = pinnedNames.size
      ? cachedTools.filter((t) => !pinnedNames.has(t.name))
      : cachedTools;

    const missingPins = pinnedNames.size
      ? [...pinnedNames].filter((n) => !cachedTools.some((t) => t.name === n))
      : [];
    if (missingPins.length > 0) {
      ctx.ui.notify(
        `[connectors] pinned tool(s) not found on gateway: ${missingPins.join(", ")}`,
        "warning",
      );
    }

    for (const tool of pinnedTools) {
      pi.registerTool(createStandaloneConnectorTool(tool, () => mcpSession));
    }

    // Discovery meta-tools (list / search / describe / call) are
    // decorrelated from pinned tools: pinning still runs whenever
    // `connectors.enabled` is on, but the meta-tools are skipped when
    // `connectors.discoveryTools` is off.
    if (!registerDiscoveryTools) {
      return;
    }

    pi.registerTool(createConnectorListTool(cachedConnectors, proxiedTools));
    pi.registerTool(createConnectorToolSearchTool(proxiedTools, connectorIds));
    pi.registerTool(createConnectorToolDescribeTool(proxiedTools));
    pi.registerTool(
      createConnectorToolCallTool(proxiedTools, () => mcpSession),
    );
  });
}
