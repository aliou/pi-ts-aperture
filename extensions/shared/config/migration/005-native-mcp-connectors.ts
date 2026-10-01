import type { Migration } from "../types";
import type { V16Config } from "./004-gateway-id";

export type PreV17Config = V16Config;

export interface V17Config extends Omit<PreV17Config, "connectors"> {
  connectors?: {
    enabled?: boolean;
  };
}

/**
 * Connector pinning and discovery moved to pi-native MCP. The extension now
 * registers the gateway with `exposure: "deferred"` (pi's `tool_search`
 * discovery, replacing `discoveryTools`), and pinning is a per-tool
 * `toolExposure` entry in `mcp.json` — 1:1 with the old config:
 *
 *   "mcpServers": {
 *     "aperture": {
 *       "url": "<baseUrl>/v1/mcp",
 *       "exposure": "deferred",
 *       "toolExposure": { "github_list_repos": "direct" }
 *     }
 *   }
 *
 * `direct` pins like the old `pinnedTools` entries did, `hidden` suppresses a
 * tool. The entries are not copied over — `mcp.json` is pi's file, not this
 * extension's to write — so pinning pauses until re-expressed there.
 */
export const nativeMcpConnectorsMigration: Migration<PreV17Config, V17Config> =
  {
    name: "005-native-mcp-connectors",
    version: "0.17.0",
    shouldRun: (config) =>
      config.connectors?.pinnedTools !== undefined ||
      config.connectors?.discoveryTools !== undefined,
    run: (config) => {
      const {
        pinnedTools: _pinnedTools,
        discoveryTools: _discoveryTools,
        ...connectors
      } = config.connectors ?? {};
      return { ...config, connectors };
    },
  };
