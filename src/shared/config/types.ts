export interface ProxiedProviderConfig {
  id: string;
  shouldCheckGatewayModels?: boolean;
}

export interface DedicatedProviderConfig {
  id: string;
  name?: string;
  enabled: boolean;
}

export type ApertureMode = "proxy" | "dedicated";

export type ApertureFeatureId = "connectors";

export interface ApertureConfig {
  baseUrl?: string;
  onboardingDone?: boolean;
  onboarding?: {
    enabled?: boolean;
  };
  proxy?: {
    enabled?: boolean;
    upstreamProviders?: ProxiedProviderConfig[];
  };
  dedicated?: {
    enabled?: boolean;
    providers?: DedicatedProviderConfig[];
    cachedModels?: unknown[];
  };
  features?: Partial<Record<ApertureFeatureId, boolean>>;

  // Legacy-only migration inputs.
  mode?: ApertureMode;
  providers?: string[];
  checkGatewayModels?: string[];
  apertureProvider?: boolean;
}

export interface ResolvedConfig {
  baseUrl: string;
  onboardingDone: boolean;
  onboarding: {
    enabled: boolean;
  };
  proxy: {
    enabled: boolean;
    upstreamProviders: Required<ProxiedProviderConfig>[];
  };
  dedicated: {
    enabled: boolean;
    providers: DedicatedProviderConfig[];
  };
  features: Record<ApertureFeatureId, boolean>;
}

export interface Migration<TConfig> {
  name: string;
  shouldRun: (config: TConfig) => boolean;
  run: (config: TConfig, filePath: string) => TConfig;
}
