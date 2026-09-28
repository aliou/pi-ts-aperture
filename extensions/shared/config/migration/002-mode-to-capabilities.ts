import type { Migration } from "../types";

export interface PreV07Config {
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
}

export interface V07Config {
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
  };
  connectors?: {
    enabled?: boolean;
    pinnedTools?: { connectorId: string; toolName: string }[];
    discoveryTools?: boolean;
  };
}

export const modeToCapabilitiesMigration: Migration<PreV07Config, V07Config> = {
  name: "002-mode-to-capabilities",
  version: "0.7.0",
  shouldRun: (config) => config.mode !== undefined,
  run: (config) => {
    const { mode, ...rest } = config;
    const migrated: V07Config = { ...rest };

    if (mode === "proxy") {
      migrated.proxy = { ...migrated.proxy, enabled: true };
      migrated.dedicated = { ...migrated.dedicated, enabled: false };
    } else if (mode === "dedicated") {
      migrated.dedicated = { ...migrated.dedicated, enabled: true };
      migrated.proxy = { ...migrated.proxy, enabled: false };
    }

    return migrated;
  },
};
