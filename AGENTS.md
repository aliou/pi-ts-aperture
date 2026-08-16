# pi-ts-aperture

Pi extension that routes LLM traffic through Tailscale Aperture.

## Purpose and risk profile

This extension integrates Pi with [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on a tailnet. Aperture handles API key injection and request routing server-side; this extension registers and routes Pi providers, models, and MCP connector tools through the gateway.

Risk profile:

- **Network-level, global config.** Aperture is a network concern, so config is global-only (`~/.pi/agent/extensions/aperture.json`), not per-project. Changes affect every Pi session.
- **No secrets in code or config.** `apiKey` is set to `"-"` because Aperture injects upstream credentials server-side. Never hardcode provider IDs, URLs, or keys.
- **Runtime tool registration is one-way.** Pi cannot unregister tools at runtime, so pinning connector tools or changing `discoveryTools` requires a full Pi restart.

## Commands and checks

Pi user-facing commands registered by this extension:

- `/aperture:onboarding` - Onboarding wizard. Only appears while onboarding is pending. Completion saves config and reloads Pi so selected providers register cleanly.
- `/aperture:settings` - Edit config: connection URL, capabilities, proxy providers and gateway checks, dedicated provider filters, pinned connector tools, onboarding status, and onboarding extension toggle. Settings syncs providers without a reload; pinned connector tools require a full Pi restart.

Development commands (`package.json` scripts, run with `pnpm`):

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit`. |
| `pnpm lint` | `biome check`. |
| `pnpm format` | `biome check --write` (applies fixes). |
| `pnpm test` | `vitest run` (unit tests, run on every push). |
| `pnpm test:watch` | `vitest` in watch mode. |
| `pnpm gen:schema` | Regenerates `schema.json` from `src/shared/config/types.ts`. |
| `pnpm check:schema` | Verifies `schema.json` is in sync with the types. |
| `pnpm check:lockfile` | `pnpm install --frozen-lockfile --ignore-scripts`. |
| `pnpm changeset` | Add a changeset entry. |
| `pnpm release` | `pnpm changeset publish`. |

The pre-commit hook (`.husky/pre-commit`) runs `typecheck`, `lint`, and `gen:schema`, then fails if `schema.json` is out of date. Always stage `schema.json` when you touch config types.

## Architecture and structure

Two independent extensions live under `extensions/`:

- `extensions/aperture/` - The main extension. Loads config, syncs dedicated and proxy providers, and registers onboarding and settings.
- `extensions/connectors/` - The connectors extension. Discovers MCP tools from Aperture's `/v1/mcp` endpoint and registers them with Pi (pinned as first-class tools, or proxied through discovery meta-tools).

Pi-agnostic Aperture API and mapping code lives under `src/`. Extension glue (Pi-dependent code) lives under `extensions/`.

### `extensions/aperture/`

- `index.ts` - Single extension entry point. Loads config, syncs proxy and dedicated providers, registers onboarding and settings.
- `proxy/runtime.ts` - `ApertureRuntime` for proxy provider registration/unregistration and gateway model verification.
- `dedicated/runtime.ts` - `registerDedicatedProvider` / `reconcileDedicatedProvider` for the standalone `aperture` provider. Model discovery and caching go through the provider's `refreshModels` (`refreshDedicatedCatalog`) and Pi's per-provider models store.
- `dedicated/provider.ts` - Native pi-ai `Provider` assembly for dedicated mode: gateway-authenticated auth (resolve always succeeds with a placeholder key), live model list adopted via `context.publish({ update })`.
- `dedicated/api-routing.ts` - Aperture compatibility-to-Pi API mapping (`getApiForCompatibility`) and stream-time dispatch (`buildStream` / `buildStreamSimple`) for dedicated mode. Per-API gateway base-URL resolution lives in the shared `src/base-url-routing.ts` (`getBaseUrlForApi`).
- `dedicated/model-defaults.ts` - Model config builder merging safe defaults, resolved metadata, and gateway pricing.
- `onboarding/index.ts` - Registers temporary onboarding affordances while onboarding is enabled.
- `onboarding/onboarding.ts` - Onboarding wizard. Steps: welcome, URL, capability selection, provider selection, recap.
- `onboarding/setup-command.ts` - `/aperture:onboarding` command registration. Saves config and reloads Pi after completion.
- `onboarding/setup-wizard.ts` - `UrlStep` TUI component with inline Aperture health check.
- `settings/index.ts` - Registration entry for the `/aperture:settings` command via `registerSettingsCommand`. Per-tab files in `settings/` build the Global / Proxy / Dedicated / Connectors sections. Includes the pinned connector tools submenu (`connectors.pinnedTools`), which uses `FilterableChecklist` and reads the live gateway tool list via `createMcpSession().listTools()`.
- `shared/filterable-checklist.ts` - Shared `FilterableChecklist` Component (search input + checkbox list with Space toggle, optional Esc-to-close). Used by the onboarding provider steps and the settings pinned-tools submenu.
- `shared/config/types.ts` - Config types.
- `shared/config/defaults.ts` - Default config. Dedicated is enabled by default.
- `shared/config/loader.ts` - Config loader instance.
- `shared/config/migration/` - Legacy config migrations.

### `extensions/connectors/`

- `index.ts` - Connector extension entry point. Splits gateway tools into pinned (registered as first-class Pi tools) vs proxied (reached through the `aperture_connector_tool_*` meta-tools) based on `connectors.pinnedTools`. The discovery meta-tools only register when `connectors.discoveryTools` is on (default `true`); pinned tools register whenever `connectors.enabled` is on.
- `proxy-tools.ts` - Defines the four prefixed proxy meta-tools (`aperture_connector_list` / `aperture_connector_tool_search` / `aperture_connector_tool_describe` / `aperture_connector_tool_call`), plus `createStandaloneConnectorTool` for pinned tools and the shared `renderConnectorCallResult` used by both the call meta-tool and standalone tools.

### `src/`

- `api/client.ts` - Pi-agnostic Aperture API client for `/api/providers` and `/v1/models` (connectors via `/api/connectors`). `providers()` cross-references `/v1/models` so disabled providers — whose models never appear there — are filtered out, leaving only enabled, callable providers.
- `api/types.ts` - Aperture API response types.
- `provider-mapping.ts` - Maps Aperture providers to local Pi registry models for proxy and dedicated selection.
- `base-url-routing.ts` - Shared gateway base-URL routing for both proxy and dedicated modes. `getBaseUrlForApi` resolves the per-API gateway base URL (Anthropic/Codex root, Gemini `/v1beta`, Vertex `/v1`, Bedrock `/bedrock`, OpenAI-SDK root-vs-`/v1` inference); `shouldUseGatewayRoot` is the low-level inference it builds on.
- `model-metadata/` - Capability metadata resolver for dedicated models. `index.ts` orchestrates precedence (Pi registry wins over models.dev) and re-exports the public API; `pi-registry.ts` and `models-dev.ts` implement one source each (including the best-effort `fetchModelsDevCatalog` fetch); `types.ts` holds the shared `ModelMetadata` shape.
- `retryable-errors.ts` - `TRANSIENT_APERTURE_ERROR_PATTERNS` and `markRetryableApertureError`, which tag transient gateway errors so Pi's auto-retry picks them up.
- `url.ts` - URL normalization helpers.
- `mcp-client.ts` - MCP client for Aperture's `/v1/mcp` Streamable HTTP endpoint (2024-11-05 protocol).

## Config shape

Source of truth: `extensions/aperture/shared/config/types.ts` and `extensions/aperture/shared/config/defaults.ts`. The JSON Schema is generated to `schema.json` via `pnpm gen:schema`.

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
    enabled?: boolean; // master switch for the connectors feature (default false)
    pinnedTools?: { connectorId: string; toolName: string }[]; // MCP tools registered as first-class Pi tools
    discoveryTools?: boolean; // register the four discovery meta-tools (default true)
  };
}
```

```ts
interface ResolvedConfig {
  baseUrl: string;
  onboardingDone: boolean;
  onboarding: { enabled: boolean };
  proxy: { enabled: boolean; upstreamProviders: Required<ProxiedProviderConfig>[] };
  dedicated: { enabled: boolean; providers: DedicatedProviderConfig[] };
  connectors: { enabled: boolean; pinnedTools: { connectorId: string; toolName: string }[]; discoveryTools: boolean };
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

Defaults: `dedicated.enabled: true`, `proxy.enabled: false`, `connectors.enabled: false`, `connectors.pinnedTools: []`, `connectors.discoveryTools: true`, `onboardingDone: false`, `onboarding.enabled: true`, empty proxy providers, empty dedicated provider filters.

There is no current `mode` setting. Legacy `mode` configs are migrated to capability flags.

## Conventions

### Capabilities

- Dedicated and proxy are independent capabilities. Dedicated is enabled by default.
- Config is global-only (no per-project scope). Aperture is a network-level concern.
- No gateway model cache is persisted in extension config; model metadata belongs in `~/.pi/agent/models.json`.

### Proxy mode

- Only overrides `baseUrl`, `apiKey`, and headers on existing providers. Model definitions are never touched.
- Skips providers with no local models because there is nothing to reroute.
- Provider selection maps Aperture providers to local Pi registry providers by id, exclusively from `/api/providers` cross-referenced with `/v1/models`, so only enabled providers (those whose models appear in `/v1/models`) are offered.
- Proxy and dedicated modes share one gateway base-URL resolver, `getBaseUrlForApi` in `src/base-url-routing.ts`. Anthropic and Codex map to the gateway root (Pi's Anthropic SDK and Codex adapter append their own API paths, `/v1/messages` and `/codex/responses`); Gemini to `/v1beta`; Vertex to `/v1`; Bedrock to `/bedrock` (Aperture's native Bedrock-compatible surface; the OpenAI-shaped `/v1` fails with a protocol error). For the OpenAI SDK APIs (`openai-completions` / `openai-responses`), a model registers against the gateway root only when its upstream base URL ends in a version segment that is not `/v1` (e.g. Z.ai `/api/coding/paas/v4`), because Aperture would otherwise double the version (`/v4/v1/chat/completions`). Root baseurls (Mistral, DeepSeek) and `/v1` baseurls (OpenAI, Groq, OpenRouter) keep `gateway/v1`, which is Aperture's standard `/v1/chat/completions` endpoint. Missing or unparseable upstream URLs keep `gateway/v1`.
- Optional per-provider gateway model verification (`shouldCheckGatewayModels`) warns if configured local models are missing from the Aperture gateway.
- Removed proxy providers trigger unregistration.

### Dedicated mode

- Registers the Pi provider as a native pi-ai `Provider`; each model carries the real upstream Pi API (`model.api`) selected from Aperture provider compatibility, and the provider's `stream`/`streamSimple` dispatch requests through it.
- Model IDs are exposed exactly as Aperture reports them. They are not prefixed with `provider::`.
- Legacy models-store snapshots (stamped with the custom `aperture` API marker and an `upstreamApi` side field) still restore: stream dispatch resolves the real API from the side field for those entries.
- Can filter gateway models by enabled `dedicated.providers`; an empty provider filter means all gateway providers are included. A non-empty list with all `enabled: false` means no dedicated models are registered.
- Resolves capability metadata per model at refresh time (`src/model-metadata.ts`): Pi's native model registry first (context window, output limit, input modalities, reasoning, `thinkingLevelMap`, `compat`), then the models.dev catalog (`https://models.dev/api.json`, best-effort fetch) as a fallback, then safe defaults (128k context, 8k output, text-only, no reasoning). Matching prefers an exact provider-id + model-id match; a model-id-only fallback copies capabilities but never cost or `compat`. Gateway pricing from `/v1/models` wins field-by-field for costs; rates the gateway omits keep the registry/models.dev value. The dedicated provider's own registry entries are excluded from metadata matching (they carry defaults from a prior refresh). `~/.pi/agent/models.json` remains the user-side override.
- Fetches provider compatibility from `/api/providers` (each gateway provider reports its `compatibility` map) and maps it to Pi APIs: OpenAI chat/completions, Anthropic messages, OpenAI responses, Gemini generate content, Google Vertex, or Bedrock converse.
- Per-model base URL is inferred from the upstream provider's base URL, looked up from Pi's native model registry (cross-referenced by provider id, then model id). Both modes resolve the per-model base URL with the shared `getBaseUrlForApi`: a model uses the gateway root only when its upstream base URL ends in a non-`/v1` version segment (e.g. Z.ai `/api/coding/paas/v4`); root baseurls (Mistral, DeepSeek) and `/v1` baseurls (OpenAI, Groq) keep `gateway/v1`. Anthropic, Gemini, Vertex, and Bedrock keep their fixed paths (`/bedrock` for Bedrock). Gateway providers with no native Pi registry match keep `gateway/v1`. Inference runs at refresh time (registry available via `session_start`); the resolved per-model base URLs persist through the models store, so cache-only restores replay them before the first revalidation.
- Model discovery and caching use Pi's `refreshModels` hook (requires Pi >= 0.80.8). The provider is registered in the extension factory body with a `refreshModels` callback; Pi immediately fires a cache-only refresh that restores the previous catalog from its per-provider models store (`~/.pi/agent/models-store.json`), so scoped models validate during startup, including offline. `session_start`/`onSync` then calls `ctx.modelRegistry.refresh()` for the networked revalidation, which fetches `/api/providers`, rebuilds and enriches the models, and writes the store back. Each store entry records a catalog key (gateway origin + normalized dedicated provider filter); cache-only restores return nothing when the key no longer matches the current config. First run with no stored catalog resolves nothing until the first networked refresh.

### Connectors

- Connector tool discovery goes through Aperture's `/v1/mcp` endpoint (Streamable HTTP, 2024-11-05 protocol). The MCP session is re-created on each `session_start`.
- Defaults to four proxy meta-tools (`aperture_connector_list`, `aperture_connector_tool_search`, `aperture_connector_tool_describe`, `aperture_connector_tool_call`), so models discover tools via list/search/describe then call. This keeps individual tool schemas out of the system prompt.
- `connectors.pinnedTools` is an allow-list of MCP tools (stored as `{ connectorId, toolName }`) that bypass the proxy meta-tools and register as first-class Pi tools. `toolName` is matched verbatim against the gateway `tools/list` response; `connectorId` is stored for traceability (it is the tool name prefix before the first `_`).
- `connectors.discoveryTools` (default `true`) toggles the four discovery meta-tools. It is decorrelated from `connectors.pinnedTools`: pinning runs whenever `connectors.enabled` is on, even when discovery is disabled. Disabling discovery avoids registering the proxy meta-tools entirely, so the model only sees pinned tool schemas. Pinning nothing and disabling discovery leaves the connector feature inert.
- Pinned tools use the raw MCP tool name (e.g. `github_list_repos`); no namespacing.
- Pinned tools that no longer exist on the gateway are silently skipped on registration, with a single warning `ui.notify`. The allow-list stays harmless when stale.
- Each pinned tool adds its full JSON Schema to the system prompt, raising context cost. The settings UI warns above a threshold (currently 10).
- Pi cannot unregister tools at runtime, so pinning takes effect on the next full Pi restart (which re-runs the extension factory). The settings submenu reads the live gateway tool list every time it opens, but saved changes only apply after reload.
- Resource proxy tools (`connector_resource_*`) were removed because Pi does not support MCP resources well enough yet. The MCP session still exposes resource methods; only the Pi tool wrappers were removed.

### Retryable errors

- Pi's retry classifier matches error text against a hardcoded pattern list extensions cannot extend. A `message_end` handler in the extension entry point appends ` (service unavailable)` to transient Aperture errors so Pi retries them. Covers both modes, since it hooks the message and not the provider.
- Add new patterns to `TRANSIENT_APERTURE_ERROR_PATTERNS` in `src/retryable-errors.ts`.

### Requests and credentials

- `apiKey` is set to `"-"` because Aperture injects the upstream provider key server-side. Pi OAuth credentials still take precedence when available.
- `Referer: https://pi.dev` and `x-session-id` (the live Pi session id) are injected on every provider request via the `before_provider_headers` hook, so `x-session-id` stays current across `/fork`, `/new`, and `/resume`. Headers are no longer baked into provider registration or a `streamSimple` wrapper.
- The extension does not send `x-upstream-provider-id`.
- URLs are normalized on input: scheme is added when missing, paths such as `/v1` are stripped to the origin, and provider registration appends the API-specific path as needed.

### General

- No hardcoded provider IDs or URLs. Works for any Aperture instance with any providers.
- Config migrations are added when the file format changes, so existing user configuration keeps working across releases.

## Testing and validation

- Unit tests live next to source as `*.test.ts` and run with `pnpm test` (vitest).
- Integration tests in `src/api/client.integration.test.ts` hit a live Aperture instance and are skipped without credentials.
- Pre-commit runs `typecheck`, `lint`, and `gen:schema`; the schema check fails the commit if `schema.json` is stale.
- CI (`.github/workflows/ci.yml`) runs lint + typecheck + tests on push and PR. The publish workflow runs after CI succeeds on `main`.

## Dependencies

- `@aliou/pi-utils-settings` - Config loader, settings command, wizard infrastructure.
- `@earendil-works/pi-coding-agent` - Extension API and settings theme helpers.
- `@earendil-works/pi-tui` - TUI components used by the setup wizard.
- `@earendil-works/pi-ai` - API provider lookup and model types.

## Versioning and release

- Uses changesets + GitHub Actions for releases. Add a changeset with `pnpm changeset` before merging.
- CI runs lint + typecheck + tests on push/PR. The publish workflow triggers after CI succeeds on `main`.
- `schema.json` is a generated artifact; regenerate it with `pnpm gen:schema` whenever config types change and commit the result alongside the type changes.

## Documentation update triggers

Update `AGENTS.md` and `README.md` when:

- Config shape, defaults, or config migrations change.
- A `/aperture:*` command is added, removed, or changes behavior.
- The set of registered connector tools or their names change.
- Provider registration, routing, headers, or credentials behavior changes.
- File structure under `extensions/` or `src/` changes meaningfully.

`schema.json` is regenerated automatically by the pre-commit hook; do not edit it by hand.
