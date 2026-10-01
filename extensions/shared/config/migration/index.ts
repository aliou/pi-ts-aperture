import type { Migration } from "../types";
import { legacyToV06Migration } from "./001-legacy-to-v0-6";
import { modeToCapabilitiesMigration } from "./002-mode-to-capabilities";
import { normalizeCapabilitiesMigration } from "./003-normalize-capabilities";
import { gatewayIdMigration } from "./004-gateway-id";
import { nativeMcpConnectorsMigration } from "./005-native-mcp-connectors";

// TODO: maybe use a shared abstract interface?
export const migrations: Migration<object>[] = [
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  normalizeCapabilitiesMigration,
  gatewayIdMigration,
  nativeMcpConnectorsMigration,
];

export {
  gatewayIdMigration,
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  nativeMcpConnectorsMigration,
  normalizeCapabilitiesMigration,
};
