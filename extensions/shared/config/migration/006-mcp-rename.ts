import type { Migration } from "../types";
import type { V17Config } from "./005-native-mcp-connectors";

export type PreV18Config = V17Config;

export interface V18Config extends Omit<PreV18Config, "connectors"> {
  mcp?: {
    enabled?: boolean;
  };
}

/**
 * The connectors feature is renamed to MCP: same toggle, same behavior, new
 * config key. The value moves verbatim; only the key changes.
 */
export const mcpRenameMigration: Migration<PreV18Config, V18Config> = {
  name: "006-mcp-rename",
  version: "0.18.0",
  shouldRun: (config) => config.connectors !== undefined && !("mcp" in config),
  run: (config) => {
    const { connectors, ...rest } = config;
    return { ...rest, mcp: connectors };
  },
};
