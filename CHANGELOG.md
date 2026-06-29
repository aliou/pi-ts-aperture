# @aliou/pi-ts-aperture

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
