# pi-ts-aperture

Pi extension that routes selected Pi providers through Tailscale Aperture.

## Structure

- `src/index.ts` - Entry point orchestration only: load config, bootstrap model visibility, register hooks, register commands.
- `src/config.ts` - Config schema (`ApertureConfig`, `ResolvedConfig`) and `ConfigLoader` instance.
- `src/providers/aperture.ts` - Core routing logic (provider overrides, model bootstrap, active-model refresh, header injection).
- `src/providers/model-config.ts` - Model synthesis and merge helpers for Aperture-discovered model IDs.
- `src/lib/aperture-api.ts` - Aperture API client helpers (`/api/providers` model discovery).
- `src/state/provider-model-cache.ts` - In-memory cache for provider model discovery.
- `src/commands/setup.ts` - `/aperture:setup` interactive wizard (URL input + provider multi-select + health check).
- `src/commands/settings.ts` - `/aperture:settings` settings UI via `registerSettingsCommand`.
- `src/lib/health.ts` - Health check helper for setup wizard.

## Key decisions

- Config is global-only (no per-project scope). Aperture is a network-level concern.
- Provider list comes from the runtime model registry (includes built-ins and extension providers), not a hardcoded list.
- `apiKey` is set to `"-"` because Aperture injects the upstream provider key server-side.
- Provider requests include provenance headers:
  - `Referer: https://pi.dev`
  - `X-Title: npm:@aliou/pi-ts-aperture`
- URLs are normalized on input: scheme is added when missing, trailing `/v1` is stripped (re-appended during provider registration).
- Startup bootstrap pre-registers OpenRouter models discovered from Aperture (`/api/providers`) so CLI model resolution can find Aperture-exposed IDs before first turn.

## Dependencies

- `@aliou/pi-utils-settings` - Config loader and settings command infrastructure.
- `@mariozechner/pi-coding-agent` - Extension API and settings theme helpers.
- `@mariozechner/pi-tui` - TUI components used by setup wizard.

## Publishing

- Uses changesets + GitHub Actions for releases.
- CI runs lint + typecheck on push/PR. Publish workflow triggers after CI succeeds on main.
