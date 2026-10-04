/**
 * Aperture gateway as a pi-native MCP server.
 *
 * Registration is session-scoped and reconciled on every load and on
 * config sync, so settings changes apply without a reload and a
 * same-name `mcp.json` entry takes precedence over it. `exposure:
 * "deferred"` keeps MCP tool schemas out of the system prompt until
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
import { isStaleCtxError } from "../shared/stale-ctx";
import { onConfigSync } from "../shared/sync-bus";

export default async function apertureMcp(pi: ExtensionAPI): Promise<void> {
  let registered = false;

  // pi invalidates the runner on session replacement and /reload, after
  // which every call on the captured pi throws a stale-ctx error. A
  // sync-driven reconcile that races that invalidation must swallow it:
  // pi installs no unhandledRejection handler, so letting it escape is
  // fatal. The replacement session's next sync re-runs the reconcile.
  let invalidated = false;
  const suppressStaleRejection = (error: unknown): void => {
    if (isStaleCtxError(error)) {
      invalidated = true;
      return;
    }
    throw error;
  };

  const reconcile = async (): Promise<void> => {
    await configLoader.load();
    if (invalidated) return;
    const config = configLoader.getConfig();
    const baseUrl = resolveGatewayUrl(config);
    if (config.mcp.enabled && baseUrl && !registered) {
      pi.registerMcpServer("aperture", {
        url: `${baseUrl}/v1/mcp`,
        exposure: "deferred",
      });
      registered = true;
    } else if ((!config.mcp.enabled || !baseUrl) && registered) {
      pi.unregisterMcpServer("aperture");
      registered = false;
    }
  };

  pi.events.on(APERTURE_FEATURE_REQUEST_EVENT, () => {
    if (!registered) return;
    pi.events.emit(
      APERTURE_FEATURE_REGISTER_EVENT,
      createFeatureRegisterPayload("mcp"),
    );
  });

  await reconcile();
  onConfigSync(pi, () => reconcile().catch(suppressStaleRejection));

  pi.on("session_shutdown", () => {
    invalidated = true;
    if (!registered) return;
    pi.unregisterMcpServer("aperture");
    registered = false;
  });
}
