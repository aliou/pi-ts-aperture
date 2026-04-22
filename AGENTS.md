# pi-ts-aperture

Pi extension that routes selected Pi providers through Tailscale Aperture.

## Structure

- `src/index.ts` - Entry point orchestration: load config, register lifecycle hooks, wire commands.
- `src/lib/config.ts` - Config schema (`ApertureConfig`, `ResolvedConfig`) and `configLoader` instance.
- `src/lib/url.ts` - URL normalization helpers (`normalizeInputUrl`, `resolveGatewayUrl`, `resolveProviderBaseUrl`).
- `src/lib/gateway.ts` - Gateway health check (`checkApertureHealth`) and model ID fetching (`fetchGatewayModelIds`).
- `src/lib/types.ts` - Internal types including `SyncDeps` and `CheckDeps` interfaces for dependency injection.
- `src/extension/runtime.ts` - `ApertureRuntime` class with `sync()` and `checkMissingModels()` methods.
- `src/commands/setup.ts` - `/aperture:setup` interactive wizard (URL input + provider multi-select + health check).
- `src/commands/settings.ts` - `/aperture:settings` settings UI via `registerSettingsCommand`.

## Key decisions

- Config is global-only (no per-project scope). Aperture is a network-level concern.
- Provider list comes from the runtime model registry (includes built-ins and extension providers), not a hardcoded list.
- Aperture only overrides `baseUrl`, `apiKey`, and `headers` on existing providers. Model definitions (reasoning, compat, thinking levels) are never touched.
- `apiKey` is set to `"-"` because Aperture injects the upstream provider key server-side.
- Provider requests include provenance headers:
  - `Referer: https://pi.dev`
  - `X-Title: npm:@aliou/pi-ts-aperture`
- URLs are normalized on input: scheme is added when missing, trailing `/v1` is stripped (re-appended during provider registration).
- Providers with no models in the registry are skipped (nothing to reroute).
- Optional per-provider gateway model verification (`checkGatewayModels` config) warns at startup if configured models are missing from the Aperture gateway.
- Removed providers trigger unregistration with a notification to `/reload` for native provider recovery.

## Dependencies

- `@aliou/pi-utils-settings` - Config loader and settings command infrastructure.
- `@mariozechner/pi-coding-agent` - Extension API and settings theme helpers.
- `@mariozechner/pi-tui` - TUI components used by setup wizard.

## Publishing

- Uses changesets + GitHub Actions for releases.
- CI runs lint + typecheck on push/PR. Publish workflow triggers after CI succeeds on main.
