# @aliou/pi-ts-aperture

## 0.12.0

### Minor Changes

- 7e76634: Native pi-ai provider registration for both modes, and a proxy-mode routing fix.

  Proxy mode: requests for extension-native providers (synthetic, neuralwatt) now go through the Aperture gateway. Sync previously re-registered providers via the name-plus-config path, which deletes the extension-native provider entry from pi's model runtime; with no base provider left, model baseUrls were never rewritten to the gateway, so requests hit upstream APIs with no credentials and 401'd. Sync now wraps the live provider (gateway baseUrls, placeholder key for anonymous providers) and re-registers it through the native path.

  Dedicated mode: the `aperture` provider is now registered as a pi-ai `Provider`, mirroring pi-synthetic and pi-neuralwatt. The provider owns its auth (gateway-authenticated: resolve always succeeds with a placeholder key, check always reports configured), owns its live model list (adopted via `context.publish`), and gains full `stream` dispatch alongside `streamSimple`.

  Peers now require pi >= 0.84; the pre/post-0.84 store shim is deleted.

### Patch Changes

- 73bdefb: Drop the custom `aperture` API marker from dedicated models. Models now carry their real upstream Pi API (from gateway compatibility), so they get API-correct option shaping — reasoning effort mapping, sampling params — instead of the generic defaults the unknown marker produced. Legacy models-store snapshots stamped with the marker still restore.
- eae7e89: Stamp dedicated Aperture models with their provider id and repair cached catalogs that were written without it, preventing Pi's model selector from crashing after first model discovery.

## 0.11.5

### Patch Changes

- b050a71: Adopt `@aliou/pi-utils-settings` 0.19.1.

  - Bumped dependency to `^0.19.1`.
  - Added semver `version` fields (`0.6.0`, `0.7.0`, `0.8.0`) to the three content-gated migrations.
  - Switched `gen:schema` and `check:schema` scripts to the new `pi-settings-schema` CLI, which injects `$schema` and `version` into `schema.json`.
  - Regenerated `schema.json` with the CLI-injected reserved properties.

## 0.11.4

### Patch Changes

- 39297ac: Let Pi auto-retry transient gateway failures. "aperture is restarting, retry this request" is now tagged in a `message_end` handler so Pi's retry classifier picks it up instead of failing the turn. Works in both dedicated and proxy mode.

## 0.11.3

### Patch Changes

- d332863: Fix dedicated-mode requests failing for models whose upstream rejects the
  `developer` role (e.g. neuralwatt's GLM/Kimi/DeepSeek).

  The model-id fallback in the Pi registry metadata resolver refused to copy
  any `compat` fields, so dedicated mode rebuilt these models with no compat at
  all. Pi's openai-completions adapter then defaulted to `supportsDeveloperRole:
true` and `maxTokensField: "max_completion_tokens"`, sending a `developer`
  system message that the upstream API rejects.

  The fallback now copies the model-intrinsic compat fields
  (`supportsDeveloperRole`, `maxTokensField`,
  `requiresReasoningContentOnAssistantMessages`), which are properties of the
  model family and consistent across providers in the registry. Endpoint-specific
  quirks (`supportsStore`, `supportsLongCacheRetention`, `deferredToolsMode`,
  `zaiToolStream`, ...) stay out of a fallback match.

## 0.11.2

### Patch Changes

- 7ee13ed: Add Pi coding-agent 0.84 compatibility for the dedicated provider refresh:

  - Catalog reads and persistence now go through a runtime shape-detection shim (`src/refresh-store-compat.ts`) that uses the 0.84 `context.stored` snapshot and `context.publish({ persist })` transaction when available, and falls back to the legacy `context.store` read/write on older hosts. The `readStoredModels` store reader became `storedCatalogModels(snapshot, catalogKey)`, preserving catalog-key validation and cache-only restore when the network is disallowed.
  - `ctx.modelRegistry.refresh()` now handles the 0.84 `ModelsRefreshResult`, notifying when `result.errors` contains the `aperture` provider error, while still catching thrown errors and staying compatible with pre-0.84 hosts that resolve with void.

  Peer ranges keep their existing floors and now also support 0.84.

## 0.11.1

### Patch Changes

- 434549d: Route proxy-mode Bedrock providers through Aperture's `/bedrock` surface and consolidate gateway base-URL routing into one shared resolver.

  Proxy mode previously inlined only `shouldUseGatewayRoot`, which is `false` for `bedrock-converse-stream`, so a proxied Bedrock provider was registered at the OpenAI-shaped `gateway/v1` and failed with a protocol error. Aperture's native Bedrock-compatible surface lives at `gateway/bedrock`. Dedicated mode already routed Bedrock to `/bedrock`; proxy now matches it.

  The per-API resolver `getBaseUrlForApi` (Anthropic/Codex root, Gemini `/v1beta`, Vertex `/v1`, Bedrock `/bedrock`, OpenAI-SDK root-vs-`/v1` inference) moves from `extensions/aperture/dedicated/api-routing.ts` to `src/base-url-routing.ts`, the shared home already documented for this logic. Both proxy and dedicated now call it, so the two modes can no longer drift.

  Side effect of the consolidation: a proxied Gemini provider now routes to `/v1beta` (matching dedicated) instead of `/v1`. This brings proxy into line with dedicated's already-shipped behavior.

## 0.11.0

### Minor Changes

- eee1395: Dedicated mode: model capability metadata and Pi models-store caching.

  Dedicated models are now enriched at refresh time instead of registering with flat safe defaults. Capability metadata (context window, output limit, vision input, reasoning, thinking levels) resolves from Pi's native model registry first, then the models.dev catalog as a fallback, then safe defaults. Gateway pricing still wins for costs, and `~/.pi/agent/models.json` remains the user-side override.

  Model discovery and caching migrated from a custom disk cache to Pi's `refreshModels` hook and per-provider models store (`~/.pi/agent/models-store.json`). Pi restores the previous catalog synchronously at startup (including offline) and revalidates from the gateway on `session_start` and settings saves. Upstream API routing is now embedded on each model config as `upstreamApi` and persists through the store.

  Behavior changes:

  - Requires Pi >= 0.80.8 (peer dependency floor raised from 0.80.4).
  - Offline starts silently restore models from the models store instead of warning.
  - Failed gateway fetches surface through Pi's model-refresh error handling and fall back to the stored catalog.
  - The old cache file (`~/.pi/agent/cache/aperture-dedicated-models.json`) is no longer read or written.

## 0.10.0

### Minor Changes

- 46fd304: Dedicated mode now infers the gateway base URL per model from Pi's native model registry, fixing non-`/v1` upstreams like Z.ai in dedicated mode.

  Previously dedicated mode registered every OpenAI-compat model at `gateway/v1`, so Z.ai (`/api/coding/paas/v4`) produced `/v4/v1/chat/completions` and 404'd. The extension now cross-references each gateway model against Pi's registry (by provider id, then model id) to read the upstream base URL, then applies the shared `shouldUseGatewayRoot` rule: providers whose upstream base URL ends in a non-`/v1` version segment (Z.ai `/v4`) register the gateway root; root baseurls (Mistral, DeepSeek) and `/v1` baseurls (OpenAI, Groq) keep `gateway/v1`. Gateway providers with no native Pi match keep `gateway/v1`. The inference runs at sync time and the resolved per-model base URLs are baked into the on-disk cache so `registerCached` replays them before the first revalidation.

  Fixes #27 (dedicated mode).

## 0.9.4

### Patch Changes

- 2531bdd: Corrects the proxy-mode gateway-base-URL inference rule introduced in the previous release.

  The previous rule routed any upstream base URL that did not end in `/v1` to the gateway root, including root baseurls (Mistral, DeepSeek). Aperture has no `/chat/completions` route for those providers, so proxy requests to them 404'd.

  The corrected rule: a model uses the gateway root only when its upstream base URL ends in a version segment that is not `/v1` (e.g. Z.ai `/api/coding/paas/v4`), because Aperture would otherwise double the version (`/v4/v1/chat/completions`). Root baseurls and `/v1` baseurls (OpenAI, Groq, OpenRouter) keep `gateway/v1`, Aperture's standard `/v1/chat/completions` endpoint.

  The inference logic is extracted to `src/base-url-routing.ts` (`shouldUseGatewayRoot`) so dedicated mode can reuse it.

## 0.9.3

### Patch Changes

- 4ee9b0a: Proxy base URL is now inferred from each provider's upstream base URL instead of a hard-coded API allow-list.

  For OpenAI SDK APIs (`openai-completions`, `openai-responses`), providers whose upstream base URL pathname ends in `/v1` (OpenAI, Groq, etc.) register `gateway/v1`, while providers without a terminal `/v1` (Z.ai `/api/coding/paas/v4`, DeepSeek root) register the gateway root. This fixes Z.ai proxy requests hitting `…/v4/v1/chat/completions` instead of `…/v4/chat/completions`.

  `anthropic-messages` and `openai-codex-responses` keep their unconditional gateway-root behavior. The inferred upstream base URL is cached per provider so settings reloads keep the decision stable when the live model list has already been rewritten to the gateway.

## 0.9.2

### Patch Changes

- ba0ad6f: Stop sending the `X-Title` provider header so it does not override other provider configuration.

## 0.9.1

### Patch Changes

- 374fca0: Wire `/v1/models` pricing into dedicated provider model costs.

  Dedicated mode was registering every gateway model with zero cost because `/v1/models` was only used as an enabled-model filter and its `pricing` object was discarded. The client now retains each model's pricing on `modelInfoById`, and the dedicated runtime passes it through to `buildDefaultModelConfig`, so per-token USD values are converted to per-million costs on registered models and persisted to the dedicated models cache.

## 0.9.0

### Minor Changes

- b638def: Require Pi 0.80.4+ and inject request headers via the `before_provider_headers` hook.

  Provenance headers (`Referer`, `X-Title`) and `x-session-id` are now added on every provider request through Pi's `before_provider_headers` hook instead of being baked into provider registration or a custom `streamSimple` wrapper. This fixes `x-session-id` going stale across `/fork`, `/new`, and `/resume` (it was previously captured at registration time). The `streamSimple` wrapper in the proxy runtime is removed entirely; the dedicated runtime's wrapper keeps only API routing.

  Peer dependencies now require `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` at `>=0.80.4` (for the hook and the `ProviderHeaders` type); `@earendil-works/pi-tui` is loosened to `*`. The `getApiProvider` import moved to `@earendil-works/pi-ai/compat` following the pi-ai 0.80.0 entrypoint split.

## 0.8.2

### Patch Changes

- 55dfd1d: Swallow transient gateway failures in `checkMissingModels`. The proxy missing-model warning is fire-and-forget, so a 5s abort timeout or network error from `ApertureClient.providers()` (called when no cached provider list is passed in) rejected the promise and crashed Pi via `uncaughtException`. Gateway fetch errors now return early and silently, matching `enabledModelIds`'s existing swallow-and-fallback behavior.

## 0.8.1

### Patch Changes

- 2a436a8: Route proxied Anthropic requests through the Aperture root URL.

  Pi's Anthropic adapter appends `/v1/messages` itself, so registering the proxy base URL with `/v1` produced `/v1/v1/messages` and caused 404 responses before the request reached Aperture's model handler.

## 0.8.0

### Minor Changes

- 61e66dc: Filter disabled gateway providers out of proxy and dedicated flows.

  `/api/providers` lists every provider regardless of its `disabled` flag, so
  disabled providers and their models leaked into the proxy settings/onboarding
  checklist, the dedicated provider list, the dedicated model registration,
  and the proxy gateway-model check.

  `ApertureClient.providers()` now also fetches `/v1/models` (which only lists
  models for enabled providers) and:

  - drops any provider whose models are all absent from `/v1/models`, and
  - intersects each surviving provider's `models` with `/v1/models`, so only
    callable models are exposed.

  Because every consumer (proxy settings, proxy onboarding, dedicated settings,
  dedicated onboarding, dedicated runtime, `checkMissingModels`, `health`)
  goes through `providers()`, all of them now exclude disabled providers
  without further changes. If `/v1/models` is unreachable, `providers()` falls
  back to the unfiltered `/api/providers` result so a transient models-endpoint
  failure never blocks the rest of the client.

- 9f0f70e: Rename connector discovery meta-tools with an `aperture_` prefix and remove the resource proxy tools.

  - The four discovery meta-tools are now `aperture_connector_list`,
    `aperture_connector_tool_search`, `aperture_connector_tool_describe`,
    and `aperture_connector_tool_call`. The prefix avoids collisions with
    other extensions and signals the Aperture provenance.
  - Removed `connector_resource_search`, `connector_resource_describe`, and
    `connector_resource_serve`. Pi does not support MCP resources well enough
    yet, so the resource browsing flow is gone until that lands. The MCP
    session still exposes the resource methods; only the Pi tool wrappers
    were removed.

## 0.7.0

### Minor Changes

- 6d03cf5: Add connectors extension and restructure shared config.

  - Connectors: new extension that discovers MCP tools from Aperture's `/v1/mcp` endpoint and registers them with Pi. Splits tools into pinned (first-class Pi tools) and proxied (reached through discovery meta-tools).
  - Connectors config: `connectors.enabled` master switch (default `false`), `connectors.pinnedTools` stored as `{ connectorId; toolName }` objects, and `connectors.discoveryTools` toggle (default `true`) for the list / search / describe / call meta-tools.
  - Resource proxy tools (`connector_resource_search` / `connector_resource_describe` / `connector_resource_serve`) for browsing gateway resources.
  - Connector UI redesign with `@aliou/pi-utils-ui` components and Markdown rendering.
  - Settings: new Connectors tab with pinned-tools submenu driven by `FilterableChecklist`, reading live gateway tool state.
  - Config: extract shared config, types, and sync bus to `src/shared/`; add JSON Schema generation and `schema.json`; parse Aperture provider config as hujson so commented gateway configs work in settings.
  - API: Typebox schemas with response validation, live integration tests, and API-verified connector IDs.
  - Feature request/register event dispatching between aperture and connectors extensions.
  - Settings: cancel in-flight Aperture fetches when the user presses Esc on an async-loading submenu (`AsyncEditor`), instead of letting them run to the 5s timeout in the background. The abort signal is threaded through `ApertureClient`, `createMcpSession`, and `listTools`, and late resolves/rejects on a dismissed submenu are ignored so a slow gateway can no longer leave the settings panel unresponsive or silently mutate the draft.

### Patch Changes

- 8bb0984: Tolerate the admin-only `/aperture/config` endpoint so non-admin Aperture grants can use the extension.

  - `ApertureClient._fetch` now throws an `ApertureHttpError` that carries the HTTP status, so callers can tolerate specific responses.
  - `providerConfigInfos()` (and `providerBaseUrls()`) return an empty map on HTTP 403 instead of throwing. `/aperture/config` requires `role:admin` and is the only endpoint a non-admin grant cannot access; everything else (`/api/providers`, `/api/connectors`, `/v1/mcp`, model calls) returns 200 for non-admin grants.
  - Proxy provider matching already falls back to IDs via `/api/providers` when provider config info is empty, so onboarding and the proxy settings submenu keep working for non-admin users. Admin users keep the richer base-URL matching. Dedicated mode and connectors never read `/aperture/config` and are unaffected.
  - Other non-403 errors still propagate.

## 0.6.3

### Patch Changes

- 9f0255d: Parse Aperture provider config as hujson so commented gateway configs work in settings.

## 0.6.2

### Patch Changes

- a259b1e: fix(dedicated): cache models so the aperture provider restores instantly on startup

  Dedicated mode only discovered models after the gateway fetch in session_start,
  so scoped models (aperture/<id>) could not be restored at startup and surfaced
  "No models match pattern" warnings. Register the provider synchronously from a
  stale-while-revalidate disk cache in the extension factory body, then
  revalidate from the live gateway and re-register with fresh models on
  session_start/onSync. Cache lives at
  getAgentDir()/cache/aperture-dedicated-models.json and stores models plus the
  per-model upstream API route map; it is ignored when the gateway URL changes
  until revalidation rewrites it.

## 0.6.1

### Patch Changes

- a81a786: fix(proxy): define sesison id in the static provider's headers

## 0.6.0

### Minor Changes

- b365a22: Refactor Aperture into a single extension with independent dedicated and proxy capabilities.

  - Replaced the legacy `mode` setting with independent `dedicated.enabled` and `proxy.enabled` flags. Existing configs are migrated automatically.
  - Kept dedicated enabled by default while allowing proxy to be enabled at the same time.
  - Moved Pi extension code under `extensions/aperture/` and kept Pi-agnostic Aperture API/provider mapping code under `src/`.
  - Switched provider discovery to Aperture's `/api/providers` and `/aperture/config` endpoints.
  - Added shared provider mapping so onboarding and settings use the same local Pi registry matching behavior.
  - Improved proxy matching with base URL child-path matching and provider ID fallback, including the Codex root URL special case.
  - Removed dedicated model ID prefixes, persisted gateway model cache, temporary model-sync onboarding skill/tools, and `x-upstream-provider-id` request headers.
  - Updated onboarding to choose dedicated, proxy, or both, then reload Pi after saving so selected providers register cleanly.
  - Updated settings to edit connection, capabilities, proxy providers, dedicated provider filters, onboarding state, and onboarding extension state.

## 0.5.1

### Patch Changes

- e3fbc00: Fix gateway model checks to match models by provider and limit warning output per provider.

## 0.5.0

### Minor Changes

- b51d282: Rewrite extension architecture. Moves core logic to `src/lib/`, introduces `ApertureRuntime` class with dependency injection, replaces lifecycle hooks with `session_start` + `onSync` callback pattern, and adds provider unregistration with user notification.
- 00ba115: Add `streamSimple` wrapper that sends `x-session-id` header with the Pi session ID. This groups all requests from the same Pi session together in the Aperture dashboard.

### Patch Changes

- cda19d3: Drop `models` from `registerProvider` call. Rely on the baseUrl-override path instead, which preserves built-in model definitions (reasoning, compat, thinking levels) and only updates the endpoint URL.

## 0.4.0

### Minor Changes

- 2240e43: Extract pure core functions from Pi glue.

  Move decision-making logic into pure functions in src/core/:

  - URL helpers: normalizeInputUrl, resolveGatewayUrl, resolveProviderBaseUrl
  - Plan builders: buildApplyPlan, planConfigChange

  All core logic is now unit-testable with no Pi dependencies.

- 80ef5c2: Add per-provider gateway model checking.

  Validates which models are available on the gateway per configured provider.

- 5e2d45f: Add gateway model checking to settings UI.

  Shows model availability status in the settings interface.

- 748d8e1: Rewrite setup wizard with Wizard + FuzzyMultiSelector.

  Improved UX for configuring Aperture with better multi-select support.

### Patch Changes

- c60bd7f: Co-locate unit tests with source files.

  Moves core unit tests from tests/core/ to src/core/\*.test.ts.

- 124404c: Rewrite e2e tests to use RpcClient.

  Modernizes test infrastructure for better reliability.

- ccf5c1d: Replace local ModelInfo type with Model<Api> from pi-ai.

  Uses Pi canonical model type instead of duplicating the shape.

- 7fb1c7c: Update Pi packages to 0.64.0.

## 0.3.2

### Patch Changes

- 3427061: update Pi deps to 0.61.0

## 0.3.1

### Patch Changes

- 8b885ea: bump @aliou/pi-utils-settings to ^0.10.0 (local scope fix)

## 0.3.0

### Minor Changes

- dffb404: Refactor the Aperture routing implementation into focused modules and improve startup model discovery.

  ### What changed

  - Split the previous large `src/index.ts` into a clearer architecture:
    - `src/providers/aperture.ts` for routing/bootstrap/model refresh logic
    - `src/providers/model-config.ts` for model synthesis/merge helpers
    - `src/lib/aperture-api.ts` for Aperture API discovery calls
    - `src/state/provider-model-cache.ts` for in-memory model cache state
  - Keep `src/index.ts` as orchestration only (load config, register hooks/commands).
  - Preserve and explicitly inject provenance headers when routing through Aperture:
    - `Referer: https://pi.dev`
    - `X-Title: npm:@aliou/pi-ts-aperture`
  - Fix active model refresh timing by awaiting model re-resolution before request execution.
  - Improve OpenRouter CLI model selection reliability by bootstrapping discovered models from Aperture when needed.

  ### Why minor

  This release introduces observable behavior improvements (model availability/routing reliability and header behavior) in addition to internal refactoring.

## 0.2.5

### Patch Changes

- d3f068c: Fix timing issue where active model was cached before before_agent_start event fired. Now re-resolves the active model after updating the registry to ensure Aperture routing is applied correctly.

## 0.2.4

### Patch Changes

- d988f99: Remove debug log

## 0.2.3

### Patch Changes

- 3119e9a: Plug provider unregistration - call pi.unregisterProvider() immediately when providers are removed via setup/settings, instead of warning that a /reload is required. Switch to pi.registerProvider() for registration. Bump peer dep to >=0.55.3.

## 0.2.2

### Patch Changes

- 909e72c: Fix model preservation when overriding providers - delay registration to before_agent_start event so models from other extensions are not lost

## 0.2.1

### Patch Changes

- cf32bda: Move `@mariozechner/pi-tui` to peer dependencies to avoid bundling the SDK alongside the extension.

## 0.2.0

### Minor Changes

- 926f0a9: Improve `/aperture:setup` provider and connectivity flow.

  - Add URL health check during setup (`/v1/models`) before provider selection, with retry/cancel UX.
  - Build provider choices from Pi's runtime model registry so extension-registered providers (for example `pi-synthetic`) appear in the setup list.

### Patch Changes

- 2263fc2: mark pi SDK peer deps as optional to prevent koffi OOM in Gondolin VMs

## 0.1.0

### Minor Changes

- ebb9556: Initial release. Route Pi LLM providers through Tailscale Aperture.

  - `/aperture:setup` interactive wizard (base URL + provider multi-select)
  - `/aperture:settings` settings UI for updating configuration
  - Auto-registers selected providers with Aperture base URL on load

### Patch Changes

- 7388139: Fix providers not taking effect immediately after setup/settings save. Register directly on modelRegistry and re-resolve the active model when it belongs to a reconfigured provider.
