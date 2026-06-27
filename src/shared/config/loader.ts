import { buildSchemaUrl, ConfigLoader } from "@aliou/pi-utils-settings";
import pkg from "../../../package.json" with { type: "json" };
import { DEFAULT_CONFIG } from "./defaults";
import { migrations } from "./migration";
import type { ApertureConfig, ResolvedConfig } from "./types";

/**
 * Normalize each proxied provider entry so the resolved `Required` shape
 * holds at runtime regardless of what is on disk: `apertureProviderId`
 * defaults to the Pi provider `id`, and `shouldCheckGatewayModels` defaults
 * to `true`. The on-disk form is normalized by the 004 migration; this hook is
 * the runtime safety net (covers hand-edited or partially-written configs).
 */
export function normalizeProxiedProviders(
  resolved: ResolvedConfig,
): ResolvedConfig {
  if (!resolved.proxy?.upstreamProviders) return resolved;
  return {
    ...resolved,
    proxy: {
      ...resolved.proxy,
      upstreamProviders: resolved.proxy.upstreamProviders.map((provider) => ({
        id: provider.id,
        apertureProviderId: provider.apertureProviderId ?? provider.id,
        shouldCheckGatewayModels: provider.shouldCheckGatewayModels ?? true,
      })),
    },
  };
}

export const configLoader = new ConfigLoader<ApertureConfig, ResolvedConfig>(
  "aperture",
  DEFAULT_CONFIG,
  {
    scopes: ["global"],
    migrations,
    schemaUrl: buildSchemaUrl(pkg.name, pkg.version),
    afterMerge: (resolved) => normalizeProxiedProviders(resolved),
  },
);

export type {
  ApertureConfig,
  ConnectorsConfig,
  DedicatedProviderConfig,
  PinnedConnectorTool,
  ProxiedProviderConfig,
  ResolvedConfig,
} from "./types";
