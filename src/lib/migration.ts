/**
 * Config migration logic.
 *
 * Separated from config.ts so it can be tested without
 * importing the full ConfigLoader (which pulls in pi-tui).
 */

import type { ApertureConfig } from "./config";

export interface Migration<TConfig> {
  name: string;
  shouldRun: (config: TConfig) => boolean;
  run: (config: TConfig, filePath: string) => TConfig;
}

/**
 * Migration: old released config shape -> new nested config.
 *
 * Old shape:
 *   { baseUrl?, providers?, checkGatewayModels?, apertureProvider? }
 *
 * New shape:
 *   { baseUrl, mode, onboardingDone: true,
 *     proxy: { upstreamProviders: [...] }, dedicated: {} }
 *
 * If a config file exists, the user already configured Aperture,
 * so onboardingDone defaults to true.
 */
export const legacyMigration: Migration<ApertureConfig> = {
  name: "legacy-to-v0.6",
  shouldRun: (config) =>
    config.providers !== undefined ||
    config.checkGatewayModels !== undefined ||
    config.apertureProvider !== undefined ||
    (config.onboardingDone === undefined && config.baseUrl !== undefined),
  run: (config) => {
    const migrated: ApertureConfig = { ...config };

    // Track whether legacy providers existed before we delete them
    const hadProviders =
      migrated.providers !== undefined ||
      migrated.checkGatewayModels !== undefined;

    // Migrate providers/checkGatewayModels -> proxy.upstreamProviders
    if (hadProviders) {
      const providers = migrated.providers ?? [];
      const checked = migrated.checkGatewayModels ?? [];
      migrated.proxy = {
        upstreamProviders: providers.map((id) => ({
          id,
          shouldCheckGatewayModels: checked.includes(id),
        })),
      };
      delete migrated.providers;
      delete migrated.checkGatewayModels;
    }

    // apertureProvider -> mode
    if (migrated.apertureProvider !== undefined) {
      migrated.mode = migrated.apertureProvider ? "dedicated" : "proxy";
      delete migrated.apertureProvider;
    } else if (hadProviders) {
      // Had providers but no apertureProvider flag -> was using proxy mode
      migrated.mode = "proxy";
    }

    // If config had a baseUrl but no onboardingDone, user already configured
    if (migrated.onboardingDone === undefined && migrated.baseUrl) {
      migrated.onboardingDone = true;
    }

    // Ensure dedicated exists
    if (!migrated.dedicated) {
      migrated.dedicated = { providers: [], cachedModels: [] };
    } else if (!migrated.dedicated.cachedModels) {
      migrated.dedicated.cachedModels = [];
    }

    // Ensure proxy exists if mode is proxy
    if (migrated.mode === "proxy" && !migrated.proxy) {
      migrated.proxy = { upstreamProviders: [] };
    }

    return migrated;
  },
};
