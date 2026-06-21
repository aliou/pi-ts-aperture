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

/**
 * Connector tool pinning.
 *
 * Pinned tool names are matched verbatim against the MCP tool names returned
 * by Aperture's /v1/mcp endpoint. Pinned tools are registered as first-class
 * Pi tools instead of being reached through the connector proxy meta-tools.
 *
 * Pinned names that no longer exist on the gateway are silently skipped on
 * registration. The list is an allow-list, so stale entries are harmless.
 *
 * Each pinned tool adds its full schema to the system prompt, which raises
 * context cost. Prefer pinning only the few tools you use every session.
 */
export interface ConnectorsConfig {
  pinnedTools?: string[];
  /**
   * Register the connector discovery meta-tools (list / search /
   * describe / call).
   *
   * When disabled, only pinned tools are registered as first-class Pi
   * tools. Toggle independent of `features.connectors`, which still
   * gates whether pinning runs at all.
   */
  discoveryTools?: boolean;
}

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
  connectors?: ConnectorsConfig;
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
  connectors: {
    pinnedTools: string[];
    discoveryTools: boolean;
  };
  features: Record<ApertureFeatureId, boolean>;
}

export interface Migration<TConfig> {
  name: string;
  shouldRun: (config: TConfig) => boolean;
  run: (config: TConfig, filePath: string) => TConfig;
}
