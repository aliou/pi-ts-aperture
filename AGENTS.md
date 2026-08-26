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
| `pnpm gen:schema` | Regenerates `schema.json` from `extensions/shared/config/types.ts`. |
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

- `index.ts` - Single extension entry point. Loads config, detects host capabilities (native providers, per-provider refresh), syncs proxy and dedicated providers, registers onboarding and settings.
- `proxy/runtime.ts` - `ApertureRuntime` for proxy provider registration/unregistration, `keepGatewayModelsOnly` filtering, and gateway model verification. Two registration branches: native providers where the host has them, name+config elsewhere.
- `dedicated/runtime.ts` - `registerDedicatedProvider` / `reconcileDedicatedProvider` for the standalone `aperture` provider. `fetchDedicatedCatalog` builds the catalog; `refreshDedicatedCatalog` wraps it with the host's cache-only/networked store protocol.
- `dedicated/provider.ts` - `buildDedicatedProviderConfig`: the name+config registration for dedicated mode (gateway base URL, placeholder api key, `refreshModels`, `fetchDynamicModels`). The host dispatches each model through its own `model.api`, so there is no custom stream hook. The Aperture compatibility-to-Pi API mapping (`getSelectableApis`, `getApiForCompatibility`) lives in `extensions/shared/api-selection.ts`; per-API gateway base-URL resolution lives in `src/base-url-routing.ts` (`getBaseUrlForApi`).
- `dedicated/model-defaults.ts` - Model config builder merging safe defaults, resolved metadata, and gateway pricing.
- `onboarding/index.ts` - Registers temporary onboarding affordances while onboarding is enabled.
- `onboarding/onboarding.ts` - Onboarding wizard. Steps: welcome, URL, capability selection, provider selection, recap.
- `onboarding/setup-command.ts` - `/aperture:onboarding` command registration. Saves config and reloads Pi after completion.
- `onboarding/setup-wizard.ts` - `UrlStep` TUI component with inline Aperture health check.
- `settings/index.ts` - Registration entry for the `/aperture:settings` command via `registerSettingsCommand`. Per-tab files in `settings/` build the Global / Proxy / Dedicated / Connectors sections. Includes the pinned connector tools submenu (`connectors.pinnedTools`), which uses `FilterableChecklist` and reads the live gateway tool list via `createMcpSession().listTools()`. The panel renders at a fixed content height (`SETTINGS_CONTENT_HEIGHT` in `settings/shared.ts`, shared by every `SettingsDetailEditor` the tabs build); submenus forward the host's `hideHint` and expose `getShortcuts()` so the panel's single controls line always shows the open submenu's shortcuts.
- `shared/filterable-checklist.ts` - Shared `FilterableChecklist` Component (search input + checkbox list with Space toggle, optional Esc-to-close, `getShortcuts()` + optional `hideHint` for host-rendered controls lines). Used by the onboarding provider steps and the settings pinned-tools submenu.

### `extensions/connectors/`

- `index.ts` - Connector extension entry point. Splits gateway tools into pinned (registered as first-class Pi tools) vs proxied (reached through the `aperture_connector_tool_*` meta-tools) based on `connectors.pinnedTools`. The discovery meta-tools only register when `connectors.discoveryTools` is on (default `true`); pinned tools register whenever `connectors.enabled` is on.
- `proxy-tools.ts` - Defines the four prefixed proxy meta-tools (`aperture_connector_list` / `aperture_connector_tool_search` / `aperture_connector_tool_describe` / `aperture_connector_tool_call`), plus `createStandaloneConnectorTool` for pinned tools and the shared `renderConnectorCallResult` used by both the call meta-tool and standalone tools.

### `extensions/shared/`

Pi-extension concerns shared by both extensions. Note the aperture-local `extensions/aperture/shared/` holds UI components only; this is the extension-wide layer.

- `config/types.ts` - Config types.
- `config/defaults.ts` - Default config. Dedicated is enabled by default.
- `config/loader.ts` - Config loader instance.
- `config/migration/` - Legacy config migrations.
- `types.ts` - Extension-facing types (Pi `Api`, `Model`, provider sync deps) plus `HostProviderConfig`, the union of `ProviderConfig` and the `fetchDynamicModels` hook hosts without `refreshModels` use.
- `events.ts` - Extension events shared across the aperture and connectors extensions.
- `sync-bus.ts` - Config sync bus used to propagate config changes between extensions.
- `provider-mapping.ts` - Maps Aperture providers to local Pi registry models for proxy and dedicated selection, preserving per-provider config toggles. Extension glue consumed by the settings tabs and onboarding.
- `api-selection.ts` - Compatibility-map to Pi API mapping (`getSelectableApis` in auto-pick precedence order, `getApiForCompatibility`, `isSelectableApi` override validation) shared by dedicated, proxy, and the settings tabs. Compatibility flags Pi cannot dispatch are excluded. `openai_responses` maps to the generic `openai-responses` adapter even for the `openai-codex` gateway provider (the Codex-specific `openai-codex-responses` adapter is not selectable).

### `src/`

- `api/client.ts` - Pi-agnostic Aperture API client for `/api/providers` and `/v1/models` (connectors via `/api/connectors`). `providers()` cross-references `/v1/models` so disabled providers — whose models never appear there — are filtered out, leaving only enabled, callable providers.
- `api/types.ts` - Aperture API response types plus their hand-written parsers (`parseApertureProvider`, `parseConnectorInfo`). Deliberately not schema-driven: a host may rewrite the bare `typebox` specifier onto its own adapter while leaving `typebox/value` on the real package, so a schema built here would not be one `Value.Check` understands.
- `base-url-routing.ts` - Shared gateway base-URL routing for both proxy and dedicated modes. `getBaseUrlForApi` resolves the per-API gateway base URL (Anthropic/Codex root, Gemini `/v1beta`, Vertex `/v1`, Bedrock `/bedrock`, OpenAI-SDK root-vs-`/v1` inference); `shouldUseGatewayRoot` is the low-level inference it builds on.
- `model-metadata/` - Capability metadata resolver for dedicated models. `index.ts` orchestrates precedence (Pi registry wins over models.dev) and re-exports the public API; `pi-registry.ts` and `models-dev.ts` implement one source each (including the best-effort `fetchModelsDevCatalog` fetch); `types.ts` holds the shared `ModelMetadata` shape.
- `retryable-errors.ts` - `TRANSIENT_APERTURE_ERROR_PATTERNS` and `markRetryableApertureError`, which tag transient gateway errors so Pi's auto-retry picks them up.
- `url.ts` - URL normalization helpers.
- `mcp-client.ts` - MCP client for Aperture's `/v1/mcp` Streamable HTTP endpoint (2024-11-05 protocol).

## Config shape

Source of truth: `extensions/shared/config/types.ts` and `extensions/shared/config/defaults.ts`. The JSON Schema is generated to `schema.json` via `pnpm gen:schema`.

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
  proxy: { enabled: boolean; upstreamProviders: (Required<Omit<ProxiedProviderConfig, "api" | "enabled">> & Pick<ProxiedProviderConfig, "api" | "enabled">)[] };
  dedicated: { enabled: boolean; providers: DedicatedProviderConfig[] };
  connectors: { enabled: boolean; pinnedTools: { connectorId: string; toolName: string }[]; discoveryTools: boolean };
}
```

```ts
interface ProxiedProviderConfig {
  id: string;
  enabled?: boolean; // default true; false keeps per-provider settings without proxying
  shouldCheckGatewayModels?: boolean;
  keepGatewayModelsOnly?: boolean;
  api?: RoutableApi;
}

interface DedicatedProviderConfig {
  id: string;
  name?: string;
  enabled: boolean;
  api?: RoutableApi;
}
```

Defaults: `dedicated.enabled: true`, `proxy.enabled: false`, `connectors.enabled: false`, `connectors.pinnedTools: []`, `connectors.discoveryTools: true`, `onboardingDone: false`, `onboarding.enabled: true`, empty proxy providers, empty dedicated provider filters.

There is no current `mode` setting. Legacy `mode` configs are migrated to capability flags.

## Conventions

### Capabilities

- Dedicated and proxy are independent capabilities. Dedicated is enabled by default.
- Config is global-only (no per-project scope). Aperture is a network-level concern.
- No gateway model cache is persisted in extension config; model metadata belongs in `~/.pi/agent/models.json`.

### Host compatibility

The extension runs on Pi and on Pi forks whose extension host differs. There is no host name sniffing: every divergence is a capability check, or an API both hosts implement.

- **Provider registration** goes through the name+config form (`pi.registerProvider(name, config)`), which every host implements, everywhere except proxy mode's native branch. Pi's config path composes an equivalent native provider — same `refreshModels` contract, same `context.publish`, and stream dispatch through each model's own `api` — so no host needs a custom stream hook, and `@earendil-works/pi-ai/compat`'s `getApiProvider` (absent on forks that alias the compat subpath to the pi-ai root shim) is never imported.
- **Native providers** are used only by proxy mode, and only when `ctx.modelRegistry.getProvider` exists (see the branch note under Proxy mode). `SyncDeps.native` is one optional object rather than two optional functions so half a pair cannot silently fall to the config branch.
- **Catalog refresh** goes through `refreshModels` where the host drives it, and `fetchDynamicModels` where the host fetches and caches the catalog itself. `HostProviderConfig` carries both; each host ignores the key it does not know. `onSync` forces the networked refresh with `modelRegistry.refreshProvider(id, "online")` when that exists — the only call that bypasses a per-provider catalog cache — else `modelRegistry.refresh()`. The result shape is the host's, so the per-provider error is read through a runtime narrowing (`refreshErrorFor`), never a cast.
- **A config registration merges by model id**; it does not replace the provider's catalog. That is what makes proxy mode's config branch keep upstream ids, and it is why a passthrough provider cannot be expressed there at all: a config can only carry a literal/env/command `apiKey`, and a registration that defines models with neither `apiKey` nor `oauth` is rejected outright.
- **Session transitions** decide how current the baked headers are. pi routes `/fork`, `/new` and `/resume` back through `session_start` and sets the header per request anyway; the fork emits `session_switch` (new/resume) and `session_branch` (fork) as separate events. The entry point subscribes to all three with the same handler — `pi.on` stores handlers for event names a host does not know, so the extra two are inert on pi — because on a host without `before_provider_headers` a transition that never reaches `onSync` leaves `x-session-id` stale.
- **A config registration outlives the sync that made it.** Skipping a provider on a later sync does not undo an earlier registration, so `ApertureRuntime` tracks what it registered through the config path and explicitly unregisters a provider that turns out to be passthrough. For the same reason the config branch refuses to register at all when the gateway catalog could not be fetched: without it there is no evidence a provider is not passthrough, and guessing wrong sends `Bearer -` where the user's own credential belongs. The native branch keeps its historical fail-open there.
- **Gateway JSON parsing** is hand-written rather than schema-driven; see `src/api/types.ts` in the file map for why.
- Tool parameter schemas keep using the bare `typebox` specifier: that is the one place the host's own flavor is the right one, since it is what the host validates arguments against. Only immutable `default` values are safe there (a mutable `{}` / `[]` default is rejected by at least one host's adapter).

### Proxy mode

- Only overrides `baseUrl`, `apiKey`, and headers on existing providers. Model definitions are never touched, with one opt-in exception: a per-provider `api` override rewrites `model.api` on that provider's models. On config-registration hosts the definitions are re-registered rather than wrapped, so they are rebuilt from the first-seen models with the same fields.
- Skips providers with no local models because there is nothing to reroute.
- Provider selection maps Aperture providers to local Pi registry providers by id, exclusively from `/api/providers` cross-referenced with `/v1/models`, so only enabled providers (those whose models appear in `/v1/models`) are offered.
- Proxy and dedicated modes share one gateway base-URL resolver, `getBaseUrlForApi` in `src/base-url-routing.ts`. Anthropic and Codex map to the gateway root (Pi's Anthropic SDK and Codex adapter append their own API paths, `/v1/messages` and `/codex/responses`); Gemini to `/v1beta`; Vertex to `/v1`; Bedrock to `/bedrock` (Aperture's native Bedrock-compatible surface; the OpenAI-shaped `/v1` fails with a protocol error). For the OpenAI SDK APIs (`openai-completions` / `openai-responses`), a model registers against the gateway root only when its upstream base URL ends in a version segment that is not `/v1` (e.g. Z.ai `/api/coding/paas/v4`), because Aperture would otherwise double the version (`/v4/v1/chat/completions`). Root baseurls (Mistral, DeepSeek) and `/v1` baseurls (OpenAI, Groq, OpenRouter) keep `gateway/v1`, which is Aperture's standard `/v1/chat/completions` endpoint. Missing or unparseable upstream URLs keep `gateway/v1`.
- Two registration branches. Where the host has native providers, `sync` re-registers a wrapped `Provider` (see the note in `sync()` for why the config path is wrong there) whose `stream`/`streamSimple` rewrite the request model id to the provider-qualified form (`provider/model-id`), which the gateway forwards verbatim (its bare-id resolution lowercases and mispicks on duplicate registration). `getModels()` keeps bare ids, so the model picker, `checkMissingModels`, and `keepGatewayModelsOnly` are unaffected. Where the host has none, `sync` registers by name+config with the provider's **own** model ids: config registration merges by id, so keeping the upstream id overwrites the provider's definition and reroutes it, while a qualified id would register a second gateway-bound copy of every model beside the untouched upstream one. That branch pays the gateway's bare-id resolution (issue #78), because it has no per-provider stream hook to rewrite ids at request time.
- Config-branch limits, all of them consequences of merge-by-id. Each model keeps its own `api` (a provider can span APIs), and its base URL is resolved from that api, matching the native branch. A **passthrough** provider is skipped with a warning — its credential cannot be expressed in a config — and unregistered if an earlier sync had already rerouted it. **`keepGatewayModelsOnly`** can only choose what to reroute, never what to hide, since the models it leaves out keep their upstream definitions; it warns rather than pretending to filter, including when it filters everything. A registration the host refuses is caught per provider, so one bad provider does not cost the rest of the list; the warning does not claim the host rolled anything back, because that is the host's business.
- Auth depends on the gateway provider's `auth_mode`. Override/none providers (the common case; gateway injects or strips the upstream credential) get a placeholder-key override: both `check` and `resolve` are replaced so the provider always counts as configured (env-key providers otherwise hide from the model picker when no env key is set) and requests carry `apiKey: "-"`. Passthrough providers (`requires_client_auth` on `/api/providers`) keep native auth so the client sends a real key/OAuth token the gateway forwards. OAuth-only providers (no `apiKey` field, e.g. `openai-codex`) also keep native auth. The passthrough set is re-derived each sync from the single `/api/providers` fetch that also serves `keepGatewayModelsOnly` filtering (`fetchProviders`), failing open to an empty set. The config branch can only express the override/none half (`apiKey: "-"`); passthrough providers are skipped there, as noted above.
- Optional per-provider gateway model verification (`shouldCheckGatewayModels`) warns if configured local models are missing from the Aperture gateway.
- Optional per-provider `keepGatewayModelsOnly` (default `false`) filters that provider's registered models down to the gateway catalog at registration time: during `sync`, if any selected provider opts in, the runtime fetches the gateway catalog once (`ApertureClient.providers()`, the same `/api/providers` + `/v1/models` cross-reference the warning path uses) and filters the wrapped provider's `getModels()` to the models the gateway lists. Remaining model definitions are untouched. The fetch fails open: a gateway error registers everything unfiltered. A provider with every model filtered is skipped, mirroring the no-local-models convention. Filtering runs against the provider captured at the first sync (`firstSeenProviders`; from the second sync on, `deps.getProvider` returns our own filtered wrapper), so the full list comes back when the flag is toggled off and a resync runs. Also editable per provider from the Proxy tab in `/aperture:settings`.
- Optional per-provider `api` override: a configured Pi API wins over the provider's own `model.api` and drives the gateway base-URL choice. It is validated each sync against the provider's gateway compatibility map (from the same `/api/providers` fetch); an override the gateway no longer serves falls back to the provider's own api (named in the `ui.notify` warning), and stays inert when the catalog fetch fails (fail-open). The original api is read from the first-seen provider, so removing the override restores the previous routing on the next sync.
- In `/aperture:settings`, the Proxy tab's upstream-providers item lists one row per provider with its enabled state; each row opens a per-provider submenu holding the proxy toggle, the gateway options (`shouldCheckGatewayModels`, `keepGatewayModelsOnly`), and the API selector (shown when the gateway maps at least one API; the auto option shows which API it resolves to). The submenu is the extension point for new per-provider settings.
- Removed or disabled (`enabled: false`) proxy providers trigger unregistration on the next sync. Disabling a provider from the settings menu keeps its entry (and per-provider settings) in `proxy.upstreamProviders`.

### Dedicated mode

- Registered by name + config (`buildDedicatedProviderConfig`); each model carries the real upstream Pi API (`model.api`), either the per-provider `api` override or the one auto-picked from Aperture provider compatibility, and the host dispatches through it. The config sets no provider-level `api`, so a model that somehow lacks one is a loud registration error rather than a silent mis-route, and no `models` key, so a re-registration merges over the previous catalog instead of blanking it.
- Model IDs are provider-qualified (`provider/model-id`), which the gateway forwards verbatim. Unlike proxy mode this costs nothing: the dedicated provider owns its whole catalog, so there is no upstream definition to overwrite. The catalog key is suffixed ` v2` so store snapshots with bare ids are not restored.
- Can filter gateway models by enabled `dedicated.providers`; an empty provider filter means all gateway providers are included. A non-empty list with all `enabled: false` means no dedicated models are registered.
- Resolves capability metadata per model at refresh time (`src/model-metadata.ts`): Pi's native model registry first (context window, output limit, input modalities, reasoning, `thinkingLevelMap`, `compat`), then the models.dev catalog (`https://models.dev/api.json`, best-effort fetch) as a fallback, then safe defaults (128k context, 8k output, text-only, no reasoning). Matching prefers an exact provider-id + model-id match; a model-id-only fallback copies capabilities but never cost or `compat`. Gateway pricing from `/v1/models` wins field-by-field for costs; rates the gateway omits keep the registry/models.dev value. The dedicated provider's own registry entries are excluded from metadata matching (they carry defaults from a prior refresh). `~/.pi/agent/models.json` remains the user-side override.
- Fetches provider compatibility from `/api/providers` (each gateway provider reports its `compatibility` map) and maps it to Pi APIs: OpenAI chat/completions, Anthropic messages, OpenAI responses, Gemini generate content, Google Vertex, or Bedrock converse.
- Per-model base URL is inferred from the upstream provider's base URL, looked up from Pi's native model registry (cross-referenced by provider id, then model id). Both modes resolve the per-model base URL with the shared `getBaseUrlForApi`: a model uses the gateway root only when its upstream base URL ends in a non-`/v1` version segment (e.g. Z.ai `/api/coding/paas/v4`); root baseurls (Mistral, DeepSeek) and `/v1` baseurls (OpenAI, Groq) keep `gateway/v1`. Anthropic, Gemini, Vertex, and Bedrock keep their fixed paths (`/bedrock` for Bedrock). Gateway providers with no native Pi registry match keep `gateway/v1`. Inference runs at refresh time (registry available via `session_start`); the resolved per-model base URLs persist through the models store, so cache-only restores replay them before the first revalidation.
- Optional per-provider `api` override, validated on every refresh against the provider's compatibility map: an override the gateway no longer serves falls back to the auto-picked api with a `ui.notify` warning (the refresh hook has no UI channel, so the notify callback is threaded from the entry point through `registerDedicatedProvider`). Overrides only apply to enabled providers.
- In `/aperture:settings`, the Dedicated tab's provider list mirrors the Proxy tab: one row per provider with its enabled state, and each row opens a per-provider submenu holding the include toggle, and the API selector (shown when the gateway maps at least one API; the auto option shows which API it resolves to).
- Model discovery and caching use the host's catalog hook. Where the host drives it (`refreshModels`, Pi >= 0.80.8), the provider is registered in the extension factory body with the callback; Pi immediately fires a cache-only refresh that restores the previous catalog from its per-provider models store (`~/.pi/agent/models-store.json`), so scoped models validate during startup, including offline. `session_start`/`onSync` then forces the networked revalidation, which fetches `/api/providers`, rebuilds and enriches the models, and writes the store back. Each store entry records a catalog key (gateway origin + normalized dedicated provider filter, with api overrides recorded as `id@api`, + version suffix); cache-only restores return nothing when the key no longer matches the current config. First run with no stored catalog resolves nothing until the first networked refresh. Hosts that fetch and cache the catalog themselves call `fetchDynamicModels`, which runs the same `fetchDedicatedCatalog` build with no store interaction.

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
- `Referer: https://pi.dev` and `x-session-id` (the live Pi session id) are injected on every provider request via the `before_provider_headers` hook, so `x-session-id` stays current across `/fork`, `/new`, and `/resume`. Hosts without that event get the same pair baked into every registration `onSync` performs; see Host compatibility for what that costs.
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
