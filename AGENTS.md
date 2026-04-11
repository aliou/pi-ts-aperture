# pi-ts-aperture

Pi extension that routes selected Pi providers through Tailscale Aperture.

## Structure

- `src/index.ts` - Entry point orchestration only: load config, eagerly apply
  provider mode if selected, register hooks, register commands.
- `src/config.ts` - Config schema (`ApertureConfig`, `ResolvedConfig`,
  `ApertureMode`) and `ConfigLoader` instance.
- `src/providers/aperture.ts` - Mode dispatch. `applyAperture` picks between
  `applyApertureProvider` (provider mode) and the existing override path.
- `src/core/plan.ts` - Pure builders: `buildApplyPlan` (override mode),
  `buildApertureProviderPlan` (provider mode), `planConfigChange` (handles
  mode transitions and decides which providers to unregister).
- `src/commands/setup.ts` - `/aperture:setup` interactive wizard
  (URL + mode + provider multi-select + health check).
- `src/commands/settings.ts` - `/aperture:settings` settings UI; provider
  list / gateway-check items are hidden in provider mode.
- `src/lib/health.ts` - Health check + `/v1/models` parser. Handles
  Aperture's per-token pricing strings and converts to per-million.

## Key decisions

- Config is global-only (no per-project scope). Aperture is a network-level concern.
- Two mutually exclusive modes:
  - `override`: re-registers existing providers (`openai`, `anthropic`, ...).
    Only `baseUrl`, `apiKey`, and `headers` are touched; model definitions
    are never modified. Providers with no models in the registry are
    skipped. Requires the upstream provider extensions to be installed.
  - `provider`: registers a single new provider named `aperture` whose
    models are discovered from `GET <baseUrl>/v1/models`. All metadata
    comes from the gateway; fields the gateway doesn't emit are left unset.
    No upstream provider extensions are required.
- Provider mode applies eagerly at extension load (not in
  `before_agent_start`) so RPC callers like `listModels` see the provider
  immediately. Override mode stays in the hook because it needs other
  extensions' providers to already be registered.
- `apiKey` is set to `"-"` because Aperture injects the upstream provider key server-side.
- Provider requests include provenance headers:
  - `Referer: https://pi.dev`
  - `X-Title: npm:@aliou/pi-ts-aperture`
- URLs are normalized on input: scheme is added when missing, trailing `/v1` is stripped (re-appended during provider registration).
- Aperture pricing (`"0.00000100"` = $1/M tokens) is parsed as decimal
  strings and multiplied by 1e6 to match Pi's per-million cost convention
  (see `calculateCost` in `@mariozechner/pi-ai/dist/models.js` which divides
  `model.cost.input / 1_000_000`).
- Wire-only pricing fields (`image`, `web_search`, `internal_reasoning`) are
  dropped. Pi's `Model<TApi>.cost` is strictly typed as
  `{ input, output, cacheRead, cacheWrite }` and `calculateCost` only sums
  those four -- there is nowhere else in `Model<TApi>` or `Usage` to put
  per-image, per-search, or per-reasoning-token pricing.
- `Model<TApi>` fields are all non-optional (except `headers` and `compat`).
  `buildApertureProviderPlan` therefore fills every required field, using
  values from the gateway when present and `APERTURE_MODEL_DEFAULTS`
  otherwise. Defaults are picked to keep the extension usable (200k context
  window, 8192 max tokens, $0 cost, text-only input, `openai-completions`
  api) and never cross-reference pi-ai's built-in catalogue -- the gateway
  is the sole source of truth for real metadata.

## Dependencies

- `@aliou/pi-utils-settings` - Config loader and settings command infrastructure.
- `@mariozechner/pi-coding-agent` - Extension API and settings theme helpers.
- `@mariozechner/pi-tui` - TUI components used by setup wizard.

## Publishing

- Uses changesets + GitHub Actions for releases.
- CI runs lint + typecheck on push/PR. Publish workflow triggers after CI succeeds on main.
