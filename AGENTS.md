# pi-ts-aperture

Pi extension that routes LLM traffic through Tailscale Aperture.

## Capabilities

- **Dedicated provider** (`dedicated.enabled: true`): registers a standalone `aperture` provider whose models come from the Aperture gateway. Enabled by default. Users can include all gateway providers or filter to selected gateway providers.
- **Proxy existing providers** (`proxy.enabled: true`): reroutes selected existing Pi providers (anthropic, openai, openai-codex, etc.) through Aperture, keeping their original model definitions.

The capabilities are independent. Users can enable dedicated, proxy, or both.

## Structure

- `extensions/aperture/index.ts` - Single extension entry point. Loads config, syncs proxy and dedicated providers, registers onboarding and settings.
- `extensions/aperture/proxy/runtime.ts` - `ApertureRuntime` for proxy provider registration/unregistration and gateway model verification.
- `extensions/aperture/dedicated/runtime.ts` - `DedicatedRuntime` for registering the standalone `aperture` provider from Aperture gateway providers and models.
- `extensions/aperture/dedicated/api-routing.ts` - Aperture compatibility-to-Pi API routing helpers for dedicated mode.
- `extensions/aperture/dedicated/model-defaults.ts` - Safe default model config builder for Aperture provider models.
- `extensions/aperture/dedicated/models-cache.ts` - Stale-while-revalidate disk cache (`getAgentDir()/cache/aperture-dedicated-models.json`) for dedicated models and per-model upstream API routes, used to register the provider instantly on startup.
- `extensions/aperture/onboarding/index.ts` - Registers temporary onboarding affordances while onboarding is enabled.
- `extensions/aperture/onboarding/onboarding.ts` - Onboarding wizard (`/aperture:onboarding`). Steps: welcome, URL, capability selection, provider selection, recap.
- `extensions/aperture/onboarding/setup-command.ts` - `/aperture:onboarding` command registration. Saves config and reloads Pi after completion.
- `extensions/aperture/onboarding/setup-wizard.ts` - `UrlStep` TUI component with inline Aperture health check.
- `extensions/aperture/shared/filterable-checklist.ts` - Shared `FilterableChecklist` Component (search input + checkbox list with Space toggle, optional Esc-to-close). Used by the onboarding provider steps and the settings pinned-tools submenu.
- `extensions/aperture/settings-command.ts` - `/aperture:settings` settings UI via `registerSettingsCommand`. Includes the pinned connector tools submenu (`connectors.pinnedTools`), which uses `FilterableChecklist` and reads the live gateway tool list via `createMcpSession().listTools()`.
- `extensions/connectors/index.ts` - Connector extension entry point. Splits gateway tools into pinned (registered as first-class Pi tools) vs proxied (reached through the `connector_tool_*` meta-tools) based on `connectors.pinnedTools`.
- `extensions/connectors/proxy-tools.ts` - Defines the four proxy meta-tools (list, search, describe, call), plus `createStandaloneConnectorTool` for pinned tools and the shared `renderConnectorCallResult` used by both the call meta-tool and standalone tools.
- `extensions/aperture/shared/config/types.ts` - Config types.
- `extensions/aperture/shared/config/defaults.ts` - Default config. Dedicated is enabled by default.
- `extensions/aperture/shared/config/loader.ts` - Config loader instance.
- `extensions/aperture/shared/config/migration/` - Legacy config migrations.
- `src/api/client.ts` - Pi-agnostic Aperture API client for `/api/providers` and `/aperture/config`.
- `src/api/types.ts` - Aperture API response types.
- `src/provider-mapping.ts` - Maps Aperture providers to local Pi registry models for proxy and dedicated selection.
- `src/url.ts` - URL normalization helpers.

## Config shape

```ts
interface ApertureConfig {
  baseUrl?: string;
  onboardingDone?: boolean;
  onboarding?: { enabled?: boolean };
  proxy?: {
    enabled?: boolean;
    upstreamProviders?: ProxiedProviderConfig[];
  };
  dedicated?: {
    enabled?: boolean;
    providers?: DedicatedProviderConfig[];
  };
  connectors?: {
    pinnedTools?: string[]; // MCP tool names registered as first-class Pi tools
  };
  features?: { connectors?: boolean };
}
```

```ts
interface ResolvedConfig {
  baseUrl: string;
  onboardingDone: boolean;
  onboarding: { enabled: boolean };
  proxy: { enabled: boolean; upstreamProviders: Required<ProxiedProviderConfig>[] };
  dedicated: { enabled: boolean; providers: DedicatedProviderConfig[] };
  connectors: { pinnedTools: string[] };
  features: Record<ApertureFeatureId, boolean>;
}
```

```ts
interface ProxiedProviderConfig {
  id: string;
  shouldCheckGatewayModels?: boolean;
}

interface DedicatedProviderConfig {
  id: string;
  name?: string;
  enabled: boolean;
}
```

Defaults: `dedicated.enabled: true`, `proxy.enabled: false`, `connectors.pinnedTools: []`, `features.connectors: false`, `onboardingDone: false`, `onboarding.enabled: true`, empty proxy providers, empty dedicated provider filters.

There is no current `mode` setting. Legacy `mode` configs are migrated to capability flags.

## Commands

- `/aperture:onboarding` - Onboarding wizard. Only appears when onboarding is pending. Completion saves config and reloads Pi so selected providers register cleanly.
- `/aperture:settings` - Edit config: connection URL, capabilities, proxy providers and gateway checks, dedicated provider filters, pinned connector tools, onboarding status, and onboarding extension enabled state. Settings saves sync providers without requiring reload; pinned connector tools require a full Pi restart to apply (Pi cannot unregister tools at runtime).

## Key decisions

- Config is global-only (no per-project scope). Aperture is a network-level concern.
- Dedicated and proxy are independent capabilities.
- Dedicated is enabled by default.
- No gateway model cache is persisted in extension config.
- Proxy mode only overrides `baseUrl`, `apiKey`, and headers on existing providers. Model definitions are never touched.
- Proxy mode skips providers with no local models because there is nothing to reroute.
- Proxy provider selection maps Aperture providers to local Pi registry providers by base URL, including child path matching. If base URLs are unavailable, it falls back to provider IDs.
- `openai-codex-responses` proxy registration uses the Aperture root URL because Pi's Codex adapter appends `/codex/responses` itself.
- Optional per-provider gateway model verification (`shouldCheckGatewayModels`) warns if configured local models are missing from the Aperture gateway.
- Removed proxy providers trigger unregistration.
- Dedicated mode registers the Pi provider with custom `aperture` API and routes each request through the target Pi API selected from Aperture provider compatibility.
- Dedicated model IDs are exposed exactly as Aperture reports them. They are not prefixed with `provider::`.
- Dedicated mode tracks model routing internally as `modelId -> api`.
- Dedicated mode can filter gateway models by enabled `dedicated.providers`; an empty provider filter means all gateway providers are included.
- A non-empty dedicated provider list with all `enabled: false` means no dedicated models are registered.
- Connector tools discovery goes through Aperture's `/v1/mcp` endpoint (Streamable HTTP, 2024-11-05 protocol). The MCP session is re-created on each `session_start`.
- Connector tools default to four proxy meta-tools (`connector_list`, `connector_tool_search`, `connector_tool_describe`, `connector_tool_call`), so models discover tools via list/search/describe then call. This keeps individual tool schemas out of the system prompt.
- `connectors.pinnedTools` is an allow-list of MCP tool names that should bypass the proxy meta-tools and be registered as first-class Pi tools. Names are matched verbatim against the gateway `tools/list` response.
- Pinned tools use the raw MCP tool name (e.g. `github_list_repos`); no namespacing.
- Pinned tools that no longer exist on the gateway are silently skipped on registration, with a single warning `ui.notify`. The allow-list stays harmless when stale.
- Each pinned tool adds its full JSON Schema to the system prompt, raising context cost. The settings UI warns above a threshold (currently 10).
- Pi cannot unregister tools at runtime, so pinning takes effect on the next full Pi restart (which re-runs the extension factory). The settings submenu reads the live gateway tool list every time it opens, but saved changes only apply after reload.
- Dedicated mode builds safe defaults for every gateway model: 128k context, 8k output, text-only, no reasoning.
- Dedicated mode fetches provider compatibility from `/aperture/config` and maps it to Pi APIs: OpenAI chat/completions, Anthropic messages, OpenAI responses, Gemini generate content, Google Vertex, or Bedrock converse.
- Dedicated mode uses a stale-while-revalidate on-disk cache for gateway models and per-model upstream API routes, stored at `getAgentDir()/cache/aperture-dedicated-models.json` (shape: `{ version, gatewayUrl, models, routes }`). The provider is registered from the cache synchronously in the extension factory body so Pi can validate scoped models during startup, then `session_start`/`onSync` revalidates from the live gateway, writes the cache back, and re-registers with fresh models. The cache is ignored when its `gatewayUrl` no longer matches the configured gateway, until revalidation rewrites it. First run with no cache still resolves nothing until the first revalidation.
- `apiKey` is set to `"-"` because Aperture injects the upstream provider key server-side. Pi OAuth credentials still take precedence when available.
- Provider requests include provenance headers: `Referer: https://pi.dev`, `X-Title: npm:@aliou/pi-ts-aperture`.
- Provider requests include `x-session-id` set to the Pi session ID.
- The extension does not send `x-upstream-provider-id`.
- URLs are normalized on input: scheme is added when missing, paths such as `/v1` are stripped to the origin, and provider registration appends the API-specific path as needed.
- No hardcoded provider IDs or URLs -- works for any Aperture instance with any providers.
- Config migrations are added when the file format changes, so existing user configuration keeps working across releases.

## Dependencies

- `@aliou/pi-utils-settings` - Config loader, settings command, wizard infrastructure.
- `@earendil-works/pi-coding-agent` - Extension API and settings theme helpers.
- `@earendil-works/pi-tui` - TUI components used by setup wizard.
- `@earendil-works/pi-ai` - API provider lookup and model types.

## Publishing

- Uses changesets + GitHub Actions for releases.
- CI runs lint + typecheck + tests on push/PR. Publish workflow triggers after CI succeeds on main.
