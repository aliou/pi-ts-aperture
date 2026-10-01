import type { KnownApi } from "@earendil-works/pi-ai";

/**
 * Pi APIs derivable from a gateway provider's compatibility map. Extracted
 * from pi-ai's `KnownApi`: the JSON schema needs a closed union (the open
 * `Api` type would degrade to a plain string), and the remaining KnownApi
 * members can never come from a compatibility map.
 */
export type RoutableApi = Extract<
  KnownApi,
  | "openai-completions"
  | "anthropic-messages"
  | "openai-responses"
  | "google-generative-ai"
  | "google-vertex"
  | "bedrock-converse-stream"
>;

export interface ProxiedProviderConfig {
  /** Local Pi provider id. */
  id: string;
  /** Gateway provider id used for routing; may differ from the local id. */
  gatewayId: string;
  /**
   * Proxy this provider through Aperture (default true). Set false to
   * keep per-provider settings without proxying the provider.
   */
  enabled?: boolean;
  /** Warn when configured local models are missing from the Aperture gateway. */
  shouldCheckGatewayModels?: boolean;
  /** Only register models the gateway actually serves for this provider. */
  keepGatewayModelsOnly?: boolean;
  /**
   * Route this provider's models through a specific Pi API instead of the
   * auto-detected one. Validated against the gateway compatibility map on
   * every sync; falls back to auto with a warning when not served.
   */
  api?: RoutableApi;
}

export interface DedicatedProviderConfig {
  /** Aperture provider id. */
  id: string;
  /** Optional display name override. */
  name?: string;
  /** Include this provider's models in the dedicated provider. */
  enabled: boolean;
  /**
   * Route this provider's models through a specific Pi API instead of the
   * one auto-picked from the compatibility map. Validated on every catalog
   * refresh; falls back to auto with a warning when not served. Part of the
   * catalog key, so cached catalogs under a different api are never replayed.
   */
  api?: RoutableApi;
}

/**
 * Connector tools configuration.
 *
 * `enabled` gates the entire connectors feature: when `false`, the connectors
 * extension registers nothing. When `true`, the gateway's `/v1/mcp` endpoint
 * is registered with pi as a session-scoped MCP server (deferred exposure);
 * per-tool exposure is pi-native (`toolExposure` in `mcp.json`), not part of
 * this config.
 */
export interface ConnectorsConfig {
  /**
   * Master switch for the connectors feature. When `false`, the connectors
   * extension registers nothing. Defaults to `false`.
   */
  enabled?: boolean;
}

export interface ApertureConfig {
  /**
   * JSON Schema URL. Injected by the config loader when writing config to
   * disk; not part of the TypeScript API.
   */
  $schema?: string;
  /**
   * Config schema version, stamped by content-gated migrations. Not part of
   * the TypeScript API.
   */
  version?: string;
  /** Aperture gateway base URL (e.g. `https://aperture.example.com`). */
  baseUrl?: string;
  /** Whether onboarding has been completed. */
  onboardingDone?: boolean;
  /**
   * Inject provenance headers (`Referer: https://pi.dev`, `x-session-id`)
   * on provider requests routed through Aperture. Defaults to `true`.
   *
   * Independent of this flag, headers are skipped when the user opted out
   * of pi telemetry (`PI_TELEMETRY` env override or the
   * `enableInstallTelemetry` setting), mirroring the gate pi core uses for
   * its own provider attribution headers.
   */
  shouldSendProvenanceHeaders?: boolean;
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
  shouldSendProvenanceHeaders: boolean;
  onboarding: {
    enabled: boolean;
  };
  proxy: {
    enabled: boolean;
    upstreamProviders: (Required<
      Omit<ProxiedProviderConfig, "api" | "enabled">
    > &
      Pick<ProxiedProviderConfig, "api" | "enabled">)[];
  };
  dedicated: {
    enabled: boolean;
    providers: DedicatedProviderConfig[];
  };
  connectors: {
    enabled: boolean;
  };
}

export interface Migration<TConfig, TNextConfig = TConfig> {
  name: string;
  /** semver version string that shipped this migration. */
  version?: string;
  shouldRun: (config: TConfig) => boolean;
  run: (config: TConfig, filePath: string) => TNextConfig;
}
