import type { Migration, RoutableApi } from "../types";

export interface PreV16ProviderConfig {
  id: string;
  gatewayId?: string;
  enabled?: boolean;
  shouldCheckGatewayModels?: boolean;
  keepGatewayModelsOnly?: boolean;
  api?: RoutableApi;
}

export interface V16ProviderConfig extends PreV16ProviderConfig {
  gatewayId: string;
}

export interface PreV16Config {
  $schema?: string;
  version?: string;
  baseUrl?: string;
  onboardingDone?: boolean;
  shouldSendProvenanceHeaders?: boolean;
  onboarding?: {
    enabled?: boolean;
  };
  proxy?: {
    enabled?: boolean;
    upstreamProviders?: PreV16ProviderConfig[];
  };
  dedicated?: {
    enabled?: boolean;
    providers?: {
      id: string;
      name?: string;
      enabled: boolean;
      api?: RoutableApi;
    }[];
  };
  connectors?: {
    enabled?: boolean;
    pinnedTools?: { connectorId: string; toolName: string }[];
    discoveryTools?: boolean;
  };
}

export interface V16Config extends Omit<PreV16Config, "proxy"> {
  proxy?: {
    enabled?: boolean;
    upstreamProviders?: V16ProviderConfig[];
  };
}

export const gatewayIdMigration: Migration<PreV16Config, V16Config> = {
  name: "004-gateway-id",
  version: "0.16.0",
  shouldRun: (config) =>
    config.proxy?.upstreamProviders?.some((p) => p.gatewayId === undefined) ??
    false,
  run: (config) => ({
    ...config,
    proxy: {
      ...config.proxy,
      upstreamProviders: config.proxy?.upstreamProviders?.map((p) => ({
        ...p,
        gatewayId: p.gatewayId ?? p.id,
      })),
    },
  }),
};
