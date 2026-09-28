import type { Migration } from "../types";

export interface PreV08Config {
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
  connectors?: {
    enabled?: boolean;
    pinnedTools?: { connectorId: string; toolName: string }[];
    discoveryTools?: boolean;
  };
}

export interface V08Config extends Omit<PreV08Config, "dedicated"> {
  dedicated?: {
    enabled?: boolean;
    providers?: {
      id: string;
      name?: string;
      enabled: boolean;
    }[];
  };
}

export const normalizeCapabilitiesMigration: Migration<
  PreV08Config,
  V08Config
> = {
  name: "003-normalize-capabilities",
  version: "0.8.0",
  shouldRun: (config) =>
    config.proxy?.enabled === undefined ||
    config.proxy?.upstreamProviders === undefined ||
    config.dedicated?.enabled === undefined ||
    config.dedicated?.providers === undefined ||
    config.dedicated?.cachedModels !== undefined,
  run: (config) => {
    const { cachedModels: _dropped, ...dedicated } = config.dedicated ?? {};
    const migrated: V08Config = {
      ...config,
      proxy: {
        ...config.proxy,
        enabled: config.proxy?.enabled ?? false,
        upstreamProviders: config.proxy?.upstreamProviders ?? [],
      },
      dedicated: {
        ...dedicated,
        enabled: config.dedicated?.enabled ?? true,
        providers: config.dedicated?.providers ?? [],
      },
    };
    return migrated;
  },
};
