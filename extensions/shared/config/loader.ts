import { buildSchemaUrl, ConfigLoader } from "@aliou/pi-utils-settings";
import pkg from "../../../package.json" with { type: "json" };
import { DEFAULT_CONFIG } from "./defaults";
import { migrations } from "./migration";
import type { ApertureConfig, ResolvedConfig } from "./types";

export const configLoader = new ConfigLoader<ApertureConfig, ResolvedConfig>(
  "aperture",
  DEFAULT_CONFIG,
  {
    scopes: ["global"],
    migrations,
    schemaUrl: buildSchemaUrl(pkg.name, pkg.version),
  },
);

export type {
  ApertureConfig,
  ConnectorsConfig,
  DedicatedProviderConfig,
  PinnedConnectorTool,
  ProxiedProviderConfig,
  ResolvedConfig,
  RoutableApi,
} from "./types";
