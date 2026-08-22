import type { ApertureConfig, DedicatedProviderConfig } from "../types";

/**
 * Legacy config shape from before v0.6.
 *
 * These fields are NOT part of the user-facing `ApertureConfig` and are
 * intentionally excluded from the generated JSON Schema. They exist only so
 * migrations can read and transform them out of older config files.
 */
export type ApertureMode = "proxy" | "dedicated";

export interface LegacyDedicatedConfig {
  enabled?: boolean;
  providers?: DedicatedProviderConfig[];
  /** Legacy. Migrated away. */
  cachedModels?: unknown[];
}

export interface LegacyApertureConfig
  extends Omit<ApertureConfig, "dedicated"> {
  /** Legacy. Migrated to `proxy.upstreamProviders`. */
  mode?: ApertureMode;
  /** Legacy. Migrated to `proxy.upstreamProviders`. */
  providers?: string[];
  /** Legacy. Migrated to `proxy.upstreamProviders`. */
  checkGatewayModels?: string[];
  /** Legacy. Migrated to `dedicated.enabled`. */
  apertureProvider?: boolean;
  dedicated?: LegacyDedicatedConfig;
}
