import { buildSchemaUrl, ConfigLoader } from "@aliou/pi-utils-settings";
import pkg from "../../../package.json" with { type: "json" };
import { normalizeInputUrl } from "../../../src/url";
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
    afterMerge: (resolved) => {
      const envUrl = process.env.APERTURE_BASE_URL?.trim();
      if (!envUrl) return resolved;
      return { ...resolved, baseUrl: normalizeInputUrl(envUrl) };
    },
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
