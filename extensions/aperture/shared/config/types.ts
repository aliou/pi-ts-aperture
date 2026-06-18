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
}

export interface Migration<TConfig> {
  name: string;
  shouldRun: (config: TConfig) => boolean;
  run: (config: TConfig, filePath: string) => TConfig;
}
