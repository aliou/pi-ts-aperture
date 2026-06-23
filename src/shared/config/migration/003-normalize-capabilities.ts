import type { ApertureConfig, Migration } from "../types";
import type { LegacyApertureConfig } from "./legacy";

export const normalizeCapabilitiesMigration: Migration<ApertureConfig> = {
  name: "003-normalize-capabilities",
  shouldRun: (config) =>
    config.proxy?.enabled === undefined ||
    config.proxy?.upstreamProviders === undefined ||
    config.dedicated?.enabled === undefined ||
    config.dedicated?.providers === undefined ||
    (config as LegacyApertureConfig).dedicated?.cachedModels !== undefined,
  run: (config) => {
    const migrated = { ...config } as LegacyApertureConfig;
    migrated.proxy = {
      ...migrated.proxy,
      enabled: migrated.proxy?.enabled ?? false,
      upstreamProviders: migrated.proxy?.upstreamProviders ?? [],
    };
    migrated.dedicated = {
      ...migrated.dedicated,
      enabled: migrated.dedicated?.enabled ?? true,
      providers: migrated.dedicated?.providers ?? [],
    };
    delete migrated.dedicated?.cachedModels;
    return migrated satisfies ApertureConfig;
  },
};
