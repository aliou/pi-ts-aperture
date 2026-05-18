# pi-ts-aperture

Pi extension that routes LLM traffic through Tailscale Aperture.

## Modes

- **Dedicated** (`mode: "dedicated"`): registers a standalone `aperture` provider whose models come from the Aperture gateway. Default mode. Users can include all gateway providers or filter to selected gateway providers.
- **Proxy** (`mode: "proxy"`): reroutes existing Pi providers (anthropic, openai, etc.) through Aperture, keeping their original model definitions.

## Structure

- `src/extensions/proxy/index.ts` - Entry point: proxy extension. Registers setup/settings, handles session sync.
- `src/extensions/proxy/runtime.ts` - `ApertureRuntime` class for proxy mode provider registration/unregistration and gateway model verification.
- `src/extensions/proxy/onboarding.ts` - Onboarding wizard (`/aperture:onboarding`). Steps: welcome, URL, mode, provider selection, recap.
- `src/extensions/proxy/setup-command.ts` - `/aperture:onboarding` command registration (delegates to onboarding).
- `src/extensions/proxy/setup-wizard.ts` - `UrlStep` TUI component with inline `/v1/models` health check.
- `src/extensions/proxy/settings-command.ts` - `/aperture:settings` settings UI via `registerSettingsCommand`.
- `src/extensions/provider/index.ts` - Entry point: dedicated mode. Registers cached Aperture models first, fetches fresh models, merges user-defined models, updates cache, registers `"aperture"` provider, and conditionally exposes the `sync-aperture-models` skill.
- `src/lib/config.ts` - Config schema (`ApertureConfig`, `ResolvedConfig`, `ApertureMode`, cached model types) and `configLoader` instance.
- `src/lib/migration.ts` - Legacy config migration (pre-two-mode shape -> current shape).
- `src/lib/model-defaults.ts` - Default and cached model config builders for Aperture provider models.
- `src/lib/sync-bus.ts` - Shared config sync event bus.
- `src/lib/url.ts` - URL normalization helpers (`normalizeInputUrl`, `resolveGatewayUrl`, `resolveProviderBaseUrl`).
- `src/lib/gateway.ts` - Gateway health check, model fetching, and provider extraction.
- `src/lib/types.ts` - Internal types including `SyncDeps` and `CheckDeps` interfaces for dependency injection.

## Config shape

```ts
type ApertureMode = "proxy" | "dedicated";

interface ApertureConfig {
  baseUrl?: string;
  mode?: ApertureMode;
  onboardingDone?: boolean;
  proxy?: { upstreamProviders?: ProxiedProviderConfig[] };
  dedicated?: {
    providers?: DedicatedProviderConfig[];
    cachedModels?: CachedModel[];
  };
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

interface CachedModel {
  id: string;
  providerId: string;
  providerName?: string;
  pricing?: {
    input?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    output?: string;
  };
}
```

Defaults: `mode: "dedicated"`, `onboardingDone: false`, empty proxy providers, empty dedicated provider filters, empty model cache.

## Skills

- `sync-aperture-models` - Helps the agent update `~/.pi/agent/models.json` with actual model capabilities (reasoning, context window, max tokens, modalities, costs) for Aperture dedicated mode. The skill is dynamically registered only when dedicated models are still using default capabilities. Skill content is inlined in `src/extensions/provider/index.ts` and written to a temp directory at runtime.

## Commands

- `/aperture:onboarding` - Onboarding wizard. Only appears when `onboardingDone` is not `true`. After completion, saves config with `onboardingDone: true` and reloads.
- `/aperture:settings` - Edit config: connection URL, mode, proxy providers and gateway checks, dedicated provider filters, onboarding status. Dedicated-mode saves trigger a reload because provider registration must be rebuilt.

## Key decisions

- Config is global-only (no per-project scope). Aperture is a network-level concern.
- Two modes: `dedicated` (standalone provider) and `proxy` (reroute existing providers).
- Proxy mode only overrides `baseUrl`, `apiKey`, and `headers` on existing providers. Model definitions are never touched.
- Proxy mode skips providers with no models in the registry because there is nothing to reroute.
- Optional per-provider gateway model verification (`shouldCheckGatewayModels`) warns at startup if configured models are missing from the Aperture gateway.
- Removed proxy providers trigger unregistration with a notification to `/reload` for native provider recovery.
- Dedicated mode uses `openai-completions` API for all models regardless of original provider API type.
- Dedicated mode model IDs are exposed as `provider::modelId` (using `::` separator to avoid ambiguity with slashes in model IDs); the provider prefix is stripped before requests are sent to Aperture.
- Dedicated mode registers cached models immediately when available, then fetches fresh models from Aperture `/v1/models` and re-registers if fresh models are available.
- Dedicated mode persists gateway models to `dedicated.cachedModels` for fast registration on the next startup.
- Dedicated mode can filter gateway models by enabled `dedicated.providers`; an empty provider filter means all gateway providers are included.
- Dedicated mode builds safe defaults for every gateway model: 128k context, 8k output, text-only, no reasoning, and pricing mapped from Aperture when available.
- User-defined models from `~/.pi/agent/models.json` under `providers.aperture.models` take precedence over gateway defaults, so synced/custom capabilities persist across restarts.
- Dedicated mode exposes `sync-aperture-models` only when registered models still match default capabilities. Once every model is customized/synced, the skill and warning disappear.
- `apiKey` is set to `"-"` because Aperture injects the upstream provider key server-side.
- Provider requests include provenance headers: `Referer: https://pi.dev`, `X-Title: npm:@aliou/pi-ts-aperture`.
- Provider requests include a `x-session-id` header set to the Pi session ID.
- Dedicated provider requests also include `x-upstream-provider-id` derived from the `provider::modelId` prefix.
- URLs are normalized on input: scheme is added when missing, paths such as `/v1` are stripped to the origin, and `/v1` is re-appended during provider registration.
- No hardcoded provider IDs or URLs -- works for any Aperture instance with any providers.
- Config migrations are added when the file format changes, so existing user configuration keeps working across releases.

## Dependencies

- `@aliou/pi-utils-settings` - Config loader, settings command, wizard infrastructure.
- `@earendil-works/pi-coding-agent` - Extension API and settings theme helpers.
- `@earendil-works/pi-tui` - TUI components used by setup wizard.
- `@earendil-works/pi-ai` - API provider lookup for stream wrappers.

## Publishing

- Uses changesets + GitHub Actions for releases.
- CI runs lint + typecheck + tests on push/PR. Publish workflow triggers after CI succeeds on main.
