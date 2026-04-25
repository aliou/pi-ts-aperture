# pi-ts-aperture

Pi extension that routes selected Pi providers through Tailscale Aperture.

## Structure

- `src/extensions/proxy/index.ts` - Entry point: proxy mode (overrides existing providers' `baseUrl`).
- `src/extensions/proxy/runtime.ts` - `ApertureRuntime` class for proxy mode.
- `src/extensions/proxy/setup-command.ts` - `/aperture:setup` command registration.
- `src/extensions/proxy/setup-wizard.ts` - `UrlStep` TUI component for the setup wizard.
- `src/extensions/proxy/settings-command.ts` - `/aperture:settings` settings UI via `registerSettingsCommand`.
- `src/extensions/provider/index.ts` - Entry point: provider mode (registers `"aperture"` provider).
- `src/extensions/provider/runtime.ts` - `ApertureProviderRuntime` class for provider mode.
- `src/lib/config.ts` - Config schema (`ApertureConfig`, `ResolvedConfig`) and `configLoader` instance.
- `src/lib/model-defaults.ts` - Default model config for unknown gateway models.
- `src/lib/sync-bus.ts` - Shared config sync event bus.
- `src/lib/url.ts` - URL normalization helpers (`normalizeInputUrl`, `resolveGatewayUrl`, `resolveProviderBaseUrl`).
- `src/lib/gateway.ts` - Gateway health check (`checkApertureHealth`) and model ID fetching (`fetchGatewayModelIds`).
- `src/lib/types.ts` - Internal types including `SyncDeps` and `CheckDeps` interfaces for dependency injection.

## Key decisions

- Config is global-only (no per-project scope). Aperture is a network-level concern.
- Provider list comes from the runtime model registry (includes built-ins and extension providers), not a hardcoded list.
- Aperture only overrides `baseUrl`, `apiKey`, and `headers` on existing providers. Model definitions (reasoning, compat, thinking levels) are never touched.
- `apiKey` is set to `"-"` because Aperture injects the upstream provider key server-side.
- Provider requests include provenance headers:
  - `Referer: https://pi.dev`
  - `X-Title: npm:@aliou/pi-ts-aperture`
- Provider requests include a `x-session-id` header set to the Pi session ID. This groups all requests from the same Pi session together in the Aperture dashboard.
- URLs are normalized on input: scheme is added when missing, trailing `/v1` is stripped (re-appended during provider registration).
- Providers with no models in the registry are skipped (nothing to reroute).
- Optional per-provider gateway model verification (`checkGatewayModels` config) warns at startup if configured models are missing from the Aperture gateway.
- Removed providers trigger unregistration with a notification to `/reload` for native provider recovery.
- Provider mode uses `openai-completions` API for all models regardless of original provider API type.
- Provider mode model IDs are exposed as `provider/modelId` when Aperture returns `metadata.provider.id`; the provider prefix is stripped before requests are sent to Aperture.
- Provider mode model metadata is copied from matching registry models (by provider ID and model ID, then by model ID fallback). Unrecognized models get safe defaults (128k context, 8k output, text-only, no reasoning, zero cost).

## Dependencies

- `@aliou/pi-utils-settings` - Config loader and settings command infrastructure.
- `@mariozechner/pi-coding-agent` - Extension API and settings theme helpers.
- `@mariozechner/pi-tui` - TUI components used by setup wizard.

## Publishing

- Uses changesets + GitHub Actions for releases.
- CI runs lint + typecheck on push/PR. Publish workflow triggers after CI succeeds on main.
