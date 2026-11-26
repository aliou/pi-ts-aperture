# pi-ts-aperture

Pi extension that routes LLM traffic and MCP tools through Tailscale Aperture, a managed AI gateway. It carries paid traffic and must work against any Aperture instance with any providers.

## Commands

- Use pnpm. The pre-commit hook runs `typecheck`, `lint`, and `gen:schema`, and fails if `schema.json` is stale. When config types change, stage `schema.json`. Never edit it by hand.
- Integration tests (`*.integration.test.ts`) hit a live Aperture instance and are skipped without credentials.

## Invariants

- Never hardcode provider IDs, URLs, or keys. `apiKey` is `"-"` because the gateway injects credentials server-side.
- Extensions don't share module state: pi loads each file through a fresh jiti instance. Communicate through the `pi.events` sync bus (`extensions/shared/sync-bus.ts`).
- Deferred async work must be safe after session replacement. Set an `invalidated` flag in `session_shutdown`, bail out on it after awaits, and swallow the guard error with `isStaleCtxError`. An escaping rejection crashes pi.
- pi-ai import rules: `extensions/` may only import `pi-ai/compat`, because static `pi-ai/api/*.lazy` imports fail under jiti aliases. `provider/` uses the lazy constructors and never imports `extensions/`. `src/` takes upstream streams as an injection and imports no pi-ai implementation.
- Gateway catalog fetches fail open: on error, behavior stays unchanged.
- A config format change requires a migration in `extensions/shared/config/migration/`.
- Inject `Referer` and `x-session-id` per request in `before_provider_headers`, gated on `shouldSendProvenanceHeaders` and Pi's telemetry setting. Never bake headers into provider registration.
- Pi's retry classifier is hardcoded. To make a transient Aperture error retryable, add its pattern to `TRANSIENT_APERTURE_ERROR_PATTERNS`.
- Use `ai.pango-lin.ts.net` or another clearly fake host in tests. Never use a real tailnet URL.

## Pointers

- Before changing proxy mode or the dedicated provider (model ids, base URLs, auth, shutdown, classifiers), read `docs/proxy-routing.md`.

## Documentation triggers

Update `AGENTS.md`, `README.md`, or `docs/proxy-routing.md` when any of these change: config shape or defaults, `/aperture:*` commands, tool names, or provider routing and credential behavior.
