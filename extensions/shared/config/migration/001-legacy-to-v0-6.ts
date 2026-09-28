import type { Migration } from "../types";

export interface PreV06Config {
  baseUrl?: string;
  onboardingDone?: boolean;
  providers?: string[];
  checkGatewayModels?: string[];
  apertureProvider?: boolean;
}

export interface V06Config {
  baseUrl?: string;
  onboardingDone?: boolean;
  onboarding?: {
    enabled?: boolean;
  };
  proxy?: {
    enabled?: boolean;
    upstreamProviders?: {
      id: string;
      shouldCheckGatewayModels?: boolean;
    }[];
  };
  dedicated?: {
    enabled?: boolean;
    providers?: {
      id: string;
      name?: string;
      enabled: boolean;
    }[];
    cachedModels?: unknown[];
  };
  mode?: "proxy" | "dedicated";
  providers?: string[];
  checkGatewayModels?: string[];
  apertureProvider?: boolean;
}

export const legacyToV06Migration: Migration<PreV06Config, V06Config> = {
  name: "001-legacy-to-v0-6",
  version: "0.6.0",
  shouldRun: (config) =>
    config.providers !== undefined ||
    config.checkGatewayModels !== undefined ||
    config.apertureProvider !== undefined ||
    (config.onboardingDone === undefined && config.baseUrl !== undefined),
  run: (config) => {
    const migrated: V06Config = { ...config };
    const hadProviders =
      config.providers !== undefined || config.checkGatewayModels !== undefined;

    if (hadProviders) {
      const providers = config.providers ?? [];
      const checked = config.checkGatewayModels ?? [];
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

    if (config.apertureProvider !== undefined) {
      migrated.dedicated = {
        ...migrated.dedicated,
        enabled: config.apertureProvider,
      };
      delete migrated.apertureProvider;
    }

    if (config.onboardingDone === undefined && config.baseUrl) {
      migrated.onboardingDone = true;
    }

    return migrated;
  },
};
