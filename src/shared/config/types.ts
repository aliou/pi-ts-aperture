export interface ProxiedProviderConfig {
  /**
   * Pi provider id to reroute through Aperture. This is the id Pi uses to
   * register the provider and match local models (`model.provider`). Routing
   * does not use the Aperture gateway provider id — Aperture routes by the
   * model id in the request body.
   */
  id: string;
  /**
   * Aperture gateway provider id this Pi provider maps to, from
   * `/api/providers`. Defaults to `id` when omitted (exact-id mapping), so
   * existing configs keep working. Explicitly set this when the Pi provider
   * id differs from the Aperture gateway provider id — e.g. for non-admin
   * grants that cannot use automatic base-URL matching (they get 403 on the
   * admin-only `/aperture/config`) and need a manual Pi→Aperture mapping.
   *
   * Used for the gateway model check and for display; never for routing.
   */
  apertureProviderId?: string;
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

/**
 * A pinned connector tool entry.
 *
 * `toolName` is matched verbatim against the MCP tool name returned by
 * Aperture's /v1/mcp endpoint. `connectorId` is the connector that exposes
 * the tool (the tool name prefix before the first `_`). It is stored for
 * traceability; matching is done by `toolName`.
 *
 * Pinned tools are registered as first-class Pi tools instead of being
 * reached through the connector proxy meta-tools. Entries whose `toolName`
 * no longer exists on the gateway are silently skipped on registration, so
 * stale entries are harmless.
 *
 * Each pinned tool adds its full schema to the system prompt, which raises
 * context cost. Prefer pinning only the few tools you use every session.
 */
export interface PinnedConnectorTool {
  /** Connector id exposing the tool (tool name prefix before the first `_`). */
  connectorId: string;
  /** MCP tool name (from Aperture `/v1/mcp` `tools/list`), matched verbatim. */
  toolName: string;
}

/**
 * Connector tools configuration.
 *
 * `enabled` gates the entire connectors feature: when `false`, no connector
 * tools (pinned or discovery) are registered. It replaces the former
 * `features.connectors` flag.
 */
export interface ConnectorsConfig {
  /**
   * Master switch for the connectors feature. When `false`, the connectors
   * extension registers nothing. Defaults to `false`.
   */
  enabled?: boolean;
  /**
   * MCP tools to register as first-class Pi tools instead of via the
   * discovery meta-tools. Matching is by `toolName`; stale entries are
   * silently skipped on registration.
   *
   * Each pinned tool adds its full JSON Schema to the system prompt, so
   * prefer pinning only the few tools you use every session.
   */
  pinnedTools?: PinnedConnectorTool[];
  /**
   * Register the connector discovery meta-tools
   * (list / search / describe / call).
   *
   * When `false`, only pinned tools are registered as first-class Pi tools.
   * Decorrelated from `enabled`, which still gates whether pinning runs at
   * all. Defaults to `true`.
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
    enabled: boolean;
    pinnedTools: PinnedConnectorTool[];
    discoveryTools: boolean;
  };
}

export interface Migration<TConfig> {
  name: string;
  shouldRun: (config: TConfig) => boolean;
  run: (config: TConfig, filePath: string) => TConfig;
}
