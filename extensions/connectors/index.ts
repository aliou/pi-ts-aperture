/**
 * Aperture gateway as a pi-native MCP server.
 *
 * Registration is session-scoped and re-declared on every load, so a
 * same-name `mcp.json` entry takes precedence over it. `exposure:
 * "deferred"` keeps connector tool schemas out of the system prompt until
 * pi's `tool_search` loads them; pinning and hiding live in `mcp.json`
 * (`toolExposure`) and the connection is managed with `/mcp`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveGatewayUrl } from "../../src/url";
import { configLoader } from "../shared/config/loader";
import {
  APERTURE_FEATURE_REGISTER_EVENT,
  APERTURE_FEATURE_REQUEST_EVENT,
  createFeatureRegisterPayload,
} from "../shared/events";

export default async function apertureConnectors(
  pi: ExtensionAPI,
): Promise<void> {
  await configLoader.load();
  const config = configLoader.getConfig();

  if (!config.connectors.enabled) {
    return;
  }

  const baseUrl = resolveGatewayUrl(config);
  if (!baseUrl) {
    return;
  }

  pi.events.on(APERTURE_FEATURE_REQUEST_EVENT, () => {
    pi.events.emit(
      APERTURE_FEATURE_REGISTER_EVENT,
      createFeatureRegisterPayload("connectors"),
    );
  });

  // Register unconditionally so a host without MCP handling reports the
  // registration as an extension error instead of silently dropping the
  // connector.
  pi.registerMcpServer("aperture", {
    url: `${baseUrl}/v1/mcp`,
    exposure: "deferred",
  });

  // Session-scoped: remove on shutdown so a changed config never leaves a
  // stale registration behind for the next load.
  pi.on("session_shutdown", () => {
    pi.unregisterMcpServer("aperture");
  });
}
