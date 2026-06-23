export interface ProxiedProviderConfig {
  /** Aperture provider id (matches `/api/providers` response). */
  id: string;
  /** Warn when configured local models are missing from the Aperture gateway. */
  shouldCheckGatewayModels?: boolean;
}

export interface DedicatedProviderConfig {
  /** Aperture provider id. */
  id: string;
  /** Optional display name override. */
  name?: string;
  /** Include this provider's models in the dedicated provider. */
  enabled: boolean;
}

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
  /**
   * MCP tool names (from Aperture `/v1/mcp` `tools/list`) to register as
   * first-class Pi tools instead of via the discovery meta-tools. Names are
   * matched verbatim. Stale entries are silently skipped on registration.
   *
   * Each pinned tool adds its full JSON Schema to the system prompt, so
   * prefer pinning only the few tools you use every session.
   */
  pinnedTools?: string[];
  /**
   * Register the connector discovery meta-tools
   * (list / search / describe / call).
   *
   * When `false`, only pinned tools are registered as first-class Pi tools.
   * Decorrelated from `features.connectors`, which still gates whether
   * pinning runs at all. Defaults to `true`.
   */
  discoveryTools?: boolean;
}

export interface ApertureConfig {
  /** Aperture gateway base URL (e.g. `https://aperture.example.com`). */
  baseUrl?: string;
  /** Whether onboarding has been completed. */
  onboardingDone?: boolean;
  onboarding?: {
    /** Whether the onboarding extension affordances are active. */
    enabled?: boolean;
  };
  proxy?: {
    /** Reroute selected Pi providers through Aperture. */
    enabled?: boolean;
    upstreamProviders?: ProxiedProviderConfig[];
  };
  dedicated?: {
    /** Register a standalone `aperture` provider from gateway models. */
    enabled?: boolean;
    providers?: DedicatedProviderConfig[];
  };
  connectors?: ConnectorsConfig;
  features?: Partial<Record<ApertureFeatureId, boolean>>;
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
