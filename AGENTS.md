# pi-ts-aperture

Pi extension that routes LLM traffic through [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on a tailnet. Aperture injects upstream provider credentials server-side and routes requests; this extension registers and routes Pi providers, models, and MCP connector tools through it.

## Layout

- `extensions/aperture/` - Main extension: proxy mode (`proxy/`), the dedicated `aperture` provider (`dedicated/`), onboarding wizard (`onboarding/`), settings UI (`settings/`).
- `extensions/connectors/` - Registers MCP tools discovered from Aperture's `/v1/mcp` endpoint.
- `extensions/shared/` - Config (types, defaults, loader, migrations), sync bus between the two extensions, provider mapping, Pi API selection, provenance (telemetry-gated header injection in `provenance.ts`).
- `src/` - Pi-agnostic code: Aperture API client, gateway base-URL routing, model metadata resolution, retryable-error tagging, MCP client.

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

User-facing commands: `/aperture:onboarding` (visible only while onboarding is pending; reloads Pi on completion) and `/aperture:settings` (syncs providers without a reload; pinned connector tools require a full restart).

## Invariants and gotchas

These are not obvious from reading the code. The code shows what happens; these say why and what not to break.

- **Global-only config.** Aperture is a network concern, so config lives at `~/.pi/agent/extensions/aperture.json` and has no per-project scope.
- **Base URL override.** The gateway base URL can be overridden with the `APERTURE_BASE_URL` environment variable, which takes precedence over the config file value (applied in the config loader's `afterMerge` hook, normalized via `normalizeInputUrl`, and never persisted back to disk).
- **No secrets, no hardcoded IDs.** `apiKey` is `"-"` because the gateway injects credentials server-side. Never hardcode provider IDs, URLs, or keys; the extension must work against any Aperture instance with any providers. Pi OAuth credentials still take precedence when present.
- **Tool registration is one-way.** Pi cannot unregister tools at runtime. Pinning connector tools or changing `connectors.discoveryTools` only takes effect after a full Pi restart.
- **Fail open on gateway fetches.** Catalog fetches (auth reconciliation, model filtering, api-override validation) that fail must leave behavior unchanged rather than break the session.
- **Synchronous auth placeholder.** Proxy providers get the placeholder-key auth override synchronously before the catalog fetch is awaited, so an immediate `/spawn` cannot race auth setup. Keep that ordering.
- **Model-id qualification.** Request model ids are provider-qualified (`provider/model-id`); the exception is path-embedding APIs (Gemini, Vertex, Bedrock), which must stay bare because the gateway only accepts bare ids in URL paths. `getModels()` keeps bare ids so the model picker is unaffected.
- **Model metadata belongs in `~/.pi/agent/models.json`, not in extension config.** No gateway model cache is persisted in the extension config file.
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
