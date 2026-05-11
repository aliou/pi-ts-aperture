# pi-ts-aperture

Pi extension that routes LLM traffic through Tailscale Aperture.

## Modes

- **Dedicated** (`mode: "dedicated"`): registers a standalone `aperture` provider whose models come from the Aperture gateway. Default mode.
- **Proxy** (`mode: "proxy"`): reroutes existing Pi providers (anthropic, openai, etc.) through Aperture, keeping their original model definitions.

## Structure

- `src/extensions/proxy/index.ts` - Entry point: proxy extension. Registers setup/settings, handles session sync.
- `src/extensions/proxy/runtime.ts` - `ApertureRuntime` class for proxy mode provider registration/unregistration.
- `src/extensions/proxy/onboarding.ts` - Onboarding wizard (`/aperture:onboarding`). Steps: welcome, URL, mode, proxy providers, recap.
- `src/extensions/proxy/setup-command.ts` - `/aperture:onboarding` command registration (delegates to onboarding).
- `src/extensions/proxy/setup-wizard.ts` - `UrlStep` TUI component (shared by onboarding).
- `src/extensions/proxy/settings-command.ts` - `/aperture:settings` settings UI via `registerSettingsCommand`.
- `src/extensions/provider/index.ts` - Entry point: dedicated mode. Fetches Aperture models and registers `"aperture"` provider.
- `src/lib/config.ts` - Config schema (`ApertureConfig`, `ResolvedConfig`, `ApertureMode`) and `configLoader` instance.
- `src/lib/migration.ts` - Legacy config migration (v0.5 -> v0.6 shape).
- `src/lib/model-defaults.ts` - Default model config for Aperture provider models.
- `src/lib/sync-bus.ts` - Shared config sync event bus.
- `src/lib/url.ts` - URL normalization helpers (`normalizeInputUrl`, `resolveGatewayUrl`, `resolveProviderBaseUrl`).
- `src/lib/gateway.ts` - Gateway health check (`checkApertureHealth`) and model fetching (`fetchGatewayModels`, `fetchGatewayModelIds`).
- `src/lib/types.ts` - Internal types including `SyncDeps` and `CheckDeps` interfaces for dependency injection.

## Config shape

```ts
type ApertureMode = "proxy" | "dedicated";

interface ApertureConfig {
  baseUrl?: string;
  mode?: ApertureMode;
  onboardingDone?: boolean;
  proxy?: { upstreamProviders?: ProxiedProviderConfig[] };
  dedicated?: { providers?: DedicatedProviderConfig[] };
}

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

Defaults: `mode: "dedicated"`, `onboardingDone: false`, empty proxy providers.

## Commands

- `/aperture:onboarding` - Onboarding wizard. Only appears when `onboardingDone` is not `true`. After completion, saves config with `onboardingDone: true`.
- `/aperture:settings` - Edit config: connection URL, mode, proxy providers, onboarding status.

## Key decisions

- Config is global-only (no per-project scope). Aperture is a network-level concern.
- Two modes: `dedicated` (standalone provider) and `proxy` (reroute existing providers).
- Proxy mode only overrides `baseUrl`, `apiKey`, and `headers` on existing providers. Model definitions are never touched.
- Dedicated mode uses `openai-completions` API for all models regardless of original provider API type.
- Dedicated mode model IDs are exposed as `provider::modelId` (using `::` separator to avoid ambiguity with slashes in model IDs); the provider prefix is stripped before requests are sent to Aperture.
- `apiKey` is set to `"-"` because Aperture injects the upstream provider key server-side.
- Provider requests include provenance headers: `Referer: https://pi.dev`, `X-Title: npm:@aliou/pi-ts-aperture`.
- Provider requests include a `x-session-id` header set to the Pi session ID.
- URLs are normalized on input: scheme is added when missing, trailing `/v1` is stripped (re-appended during provider registration).
- Providers with no models in the registry are skipped (nothing to reroute).
- Optional per-provider gateway model verification (`shouldCheckGatewayModels`) warns at startup if configured models are missing from the Aperture gateway.
- Removed providers trigger unregistration with a notification to `/reload` for native provider recovery.
- Dedicated mode fetches models from Aperture `/v1/models` and uses `buildDefaultModelConfig()` for every model (128k context, 8k output, text-only, no reasoning, zero cost).
- No hardcoded provider IDs or URLs -- works for any Aperture instance with any providers.
- Legacy config (v0.5: `providers`, `checkGatewayModels`, `apertureProvider`) is automatically migrated to the new shape on load.

## Dependencies

- `@aliou/pi-utils-settings` - Config loader, settings command, wizard infrastructure.
- `@mariozechner/pi-coding-agent` - Extension API and settings theme helpers.
- `@mariozechner/pi-tui` - TUI components used by setup wizard.

## Publishing

- Uses changesets + GitHub Actions for releases.
- CI runs lint + typecheck on push/PR. Publish workflow triggers after CI succeeds on main.
