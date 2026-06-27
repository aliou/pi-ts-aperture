import type { ApertureConfig, Migration } from "../types";

/**
 * Materialize `apertureProviderId` on every proxied provider entry.
 *
 * `apertureProviderId` is optional on the raw config and defaults to the Pi
 * provider `id`. Writing the default back to disk keeps persisted configs
 * self-describing and grep-able, and matches the resolved `Required` shape.
 * Runtime resolution (`normalizeProxiedProviders` in the loader) also fills
 * this, so a missing field never breaks behavior — this migration just keeps
 * the on-disk file normalized.
 *
 * Runs once for any proxied provider entry that lacks `apertureProviderId`.
 */
export const proxyProviderApertureIdMigration: Migration<ApertureConfig> = {
  name: "004-proxy-provider-aperture-id",
  shouldRun: (config) =>
    config.proxy?.upstreamProviders?.some(
      (provider) => provider.apertureProviderId === undefined,
    ) ?? false,
  run: (config) => ({
    ...config,
    proxy: {
      ...config.proxy,
      upstreamProviders:
        config.proxy?.upstreamProviders?.map((provider) => ({
          ...provider,
          apertureProviderId: provider.apertureProviderId ?? provider.id,
        })) ?? [],
    },
  }),
};
