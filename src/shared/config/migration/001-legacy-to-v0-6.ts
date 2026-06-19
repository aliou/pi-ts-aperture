import type { ApertureConfig, Migration } from "../types";

export const legacyToV06Migration: Migration<ApertureConfig> = {
  name: "001-legacy-to-v0-6",
  shouldRun: (config) =>
    config.providers !== undefined ||
    config.checkGatewayModels !== undefined ||
    config.apertureProvider !== undefined ||
    (config.onboardingDone === undefined && config.baseUrl !== undefined),
  run: (config) => {
    const migrated: ApertureConfig = { ...config };
    const hadProviders =
      migrated.providers !== undefined ||
      migrated.checkGatewayModels !== undefined;

    if (hadProviders) {
      const providers = migrated.providers ?? [];
      const checked = migrated.checkGatewayModels ?? [];
      migrated.proxy = {
        ...migrated.proxy,
        enabled: true,
        upstreamProviders: providers.map((id) => ({
          id,
          shouldCheckGatewayModels: checked.includes(id),
        })),
      };
      delete migrated.providers;
      delete migrated.checkGatewayModels;
    }

    if (migrated.apertureProvider !== undefined) {
      migrated.dedicated = {
        ...migrated.dedicated,
        enabled: migrated.apertureProvider,
      };
      delete migrated.apertureProvider;
    }

    if (migrated.onboardingDone === undefined && migrated.baseUrl) {
      migrated.onboardingDone = true;
    }

    return migrated;
  },
};
