# pi-ts-aperture

Pi extension that routes LLM traffic through [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on a tailnet. Aperture injects upstream provider credentials server-side and routes requests; this extension registers and routes Pi providers, models, and MCP tools through it.

## Layout

- `extensions/aperture/` - Main extension: proxy mode (`proxy/`), the dedicated `aperture` provider (`dedicated/`), onboarding wizard (`onboarding/`), settings UI (`settings/`).
- `extensions/mcp/` - Registers Aperture's `/v1/mcp` endpoint as a session-scoped MCP server via pi's built-in MCP support (`pi.registerMcpServer`, `exposure: "deferred"`; tools surface as `mcp__aperture__*`).
- `extensions/shared/` - Config (types, defaults, loader, migrations), sync bus between the two extensions, provider mapping, Pi API selection, api routing (registry-dispatch stream helpers shared by dedicated and proxy in `api-routing.ts`), provenance (telemetry-gated header injection in `provenance.ts`).
- `src/` - Pi-agnostic code: Aperture API client, gateway base-URL routing, model metadata resolution, retryable-error tagging.

Config types and defaults: `extensions/shared/config/types.ts` and `defaults.ts`. Read those instead of trusting any restated shape.

## Commands

Development (`pnpm`):

| Script | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `biome check` |
| `pnpm format` | `biome check --write` |
| `pnpm test` | `vitest run` |
| `pnpm gen:schema` | Regenerate `schema.json` from config types |
| `pnpm changeset` / `pnpm release` | Changeset entry / publish |

The pre-commit hook runs `typecheck`, `lint`, and `gen:schema`, then fails if `schema.json` is out of date. Always stage `schema.json` when you touch config types. Never edit `schema.json` by hand.

User-facing commands: `/aperture:onboarding` (visible only while onboarding is pending; reloads Pi on completion) and `/aperture:settings` (syncs providers without a reload; the MCP enable toggle applies immediately).

## Invariants and gotchas

These are not obvious from reading the code. The code shows what happens; these say why and what not to break.

- **Global-only config.** Aperture is a network concern, so config lives at `~/.pi/agent/extensions/aperture.json` and has no per-project scope.
- **Base URL override.** The gateway base URL can be overridden with the `APERTURE_BASE_URL` environment variable, which takes precedence over the config file value (applied in the config loader's `afterMerge` hook, normalized via `normalizeInputUrl`, and never persisted back to disk).
- **No secrets, no hardcoded IDs.** `apiKey` is `"-"` because the gateway injects credentials server-side. Never hardcode provider IDs, URLs, or keys; the extension must work against any Aperture instance with any providers. Pi OAuth credentials still take precedence when present.
- **MCP exposure is pi-native.** The extension registers only the `aperture` MCP server, session-scoped and reconciled at load and on config sync; a same-name `mcp.json` entry wins over it. Pinning or hiding MCP tools is the user's `toolExposure` in `mcp.json`, not extension config — there is no extension-side pin list to keep in sync.
- **Extensions don't share module state.** pi loads each extension file through a fresh jiti instance with `moduleCache: false`, so a module-level singleton in `extensions/shared/` is per-extension. Cross-extension communication rides pi's event bus: the config sync bus (`extensions/shared/sync-bus.ts`) emits `aperture:config:sync` on `pi.events`, and the mcp extension reconciles its registration (re-reading config from disk) on that event.
- **Deferred continuations must be stale-ctx safe.** pi invalidates the extension runner on session replacement (`/new`, `/fork`, `/resume`, `/switch`, `/reload`), after which every call on a captured `pi` throws the stale-ctx guard error — and pi installs no `unhandledRejection` handler, so one escaping a fire-and-forget chain is fatal to the process. Async continuations (mcp reconcile, aperture sync chains) set an `invalidated` flag in `session_shutdown`, bail on it after awaits, and swallow the guard error via `isStaleCtxError` (`extensions/shared/stale-ctx.ts`); the replacement session re-runs the work. See commit `194c812` and the mcp extension's invalidated-mid-reconcile test.
- **Proxy shutdown cleanup.** The main factory tracks proxy providers it actually registers. On `session_shutdown`, mark the runtime invalidated before unregistering those providers while Pi's API is still active. `/reload` reuses Pi's model runtime, so cleanup must remove wrappers before the next factory captures native providers. Remove ids from the tracked set when settings unregister a route.
- **Fail open on gateway fetches.** Catalog fetches (auth reconciliation, model filtering, api-override validation) that fail must leave behavior unchanged rather than break the session.
- **OpenAI subscription transport.** Passthrough `openai-responses` routes whose upstream base URL is exactly `https://api.openai.com/v1` keep that URL on models and redirect HTTP requests through `options.fetch` in `extensions/aperture/proxy/openai-passthrough.ts`. Pi's ChatGPT sign-in detection needs the native URL to apply its request rules. Do not copy its unsupported-field list or change native auth. Other routes keep gateway base-URL rewriting.
- **Synchronous auth placeholder.** Proxy providers get the placeholder-key auth override synchronously before the catalog fetch is awaited, so an immediate `/spawn` cannot race auth setup. Keep that ordering.
- **Model-id qualification.** Request model ids are provider-qualified (`provider/model-id`); the exception is path-embedding APIs (Gemini, Vertex, Bedrock), which must stay bare because the gateway only accepts bare ids in URL paths. `getModels()` keeps bare ids so the model picker is unaffected. Proxy streams rewrite `model` on emitted assistant messages back to the bare id (`extensions/aperture/proxy/model-id.ts`), because Pi restores a resumed session's model from the last assistant message. Before upstream dispatch, `withRequestModelId` copies matching assistant envelopes to use the request id so pi-ai preserves reasoning and signatures. Match the local provider, API, and public model id; never mutate session history or relabel turns from other models.
- **Gateway URL must survive composition and dispatch.** Pi's provider composer builds the served catalog from `getAllModels()` when present (falling back to `getModels()`), so the proxy wrapper must rewrite both; and auth resolution can rewrite `model.baseUrl` before a request reaches the provider (e.g. GitHub Copilot OAuth), so proxy streams re-stamp the gateway URL at dispatch. Without these, gateway-qualified ids go straight to the upstream vendor and 404. Only chat models are rewritten: the gateway serves chat APIs only, so classifier and image models from `getAllModels()` keep their own `api` and `baseUrl`. They still get the wrapper's placeholder auth, because Pi resolves auth per provider, not per model.
- **Proxy mapping uses two ids.** `proxy.upstreamProviders[].id` names the local Pi provider for registration and unregistering; required `gatewayId` names the gateway catalog target for compatibility, filtering, passthrough auth, and request model-id qualification. Migration 004 fills missing `gatewayId` with `id`. Settings lists gateway providers by name. Exact matches and mapped rows open routing settings; rows without a local provider open a searchable local-provider multi-select first. The routing settings contain one **Local Pi providers** multi-select. Unknown targets stay unrouted with one warning per sync; catalog fetch failure still fails open.
- **Model metadata belongs in `~/.pi/agent/models.json`, not in extension config.** No gateway model cache is persisted in the extension config file.
- **Gateway-advertised token limits outrank catalog metadata.** The context window and output limit on a `/v1/models` entry describe the route, not the model: a reseller caps a model below its native capacity, and the id shapes differ (`xai/grok-4.5` on the gateway vs `spacexai/grok-4.5` in catalogs), so metadata lookup misses models the gateway does describe. Pi sends the limit it is given, so an over-reported one is a rejected request. Everything else (reasoning, vision, thinking levels, name) still resolves from models.json, the Pi registry, then models.dev.
- **Retryable errors are tagged, not classified.** Pi's retry classifier is hardcoded, so a `message_end` handler appends ` (service unavailable)` to transient Aperture errors. New patterns go in `TRANSIENT_APERTURE_ERROR_PATTERNS` in `src/retryable-errors.ts`.
- **Config migrations are mandatory on format change.** Migrations live in `extensions/shared/config/migration/`; existing user config must keep working across releases.
- **Headers are injected per-request.** `Referer` and `x-session-id` go through the `before_provider_headers` hook so the session id stays current across `/fork`, `/new`, `/resume`. Do not bake headers into provider registration. Injection is gated per request on the `shouldSendProvenanceHeaders` config option (default `true`, toggleable in `/aperture:settings`) and on Pi's telemetry gate — a memoized read-only mirror of `PI_TELEMETRY` / `enableInstallTelemetry` in `extensions/shared/provenance.ts`.

## Testing

- Unit tests live next to source as `*.test.ts`.
- Integration tests in `src/api/*.integration.test.ts` hit a live Aperture instance and are skipped without credentials.
- CI runs lint + typecheck + tests on push/PR; publish runs after CI succeeds on `main`.
- **Example URLs in tests.** Always use `ai.pango-lin.ts.net` (the same placeholder the onboarding wizard shows) as the example Aperture hostname in tests and fixtures — never a real tailnet URL. Other clearly-fake hosts like `aperture.example.ts.net` or `ai.host.ts.net` are fine for cases where a generic hostname is more readable.

## Documentation update triggers

Update `AGENTS.md` and `README.md` when config shape or defaults change, a `/aperture:*` command changes, registered tool names change, provider registration/routing/credentials behavior changes, or the `extensions/` / `src/` split changes meaningfully.
