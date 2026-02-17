# pi-ts-aperture

Pi extension that routes LLM providers through Tailscale Aperture.

## Structure

- `src/index.ts` - Entry point. Loads config, registers providers, registers commands.
- `src/config.ts` - Config schema (`ApertureConfig`, `ResolvedConfig`) and `ConfigLoader` instance.
- `src/commands/setup.ts` - `/aperture:setup` interactive wizard (URL input + provider multi-select).
- `src/commands/settings.ts` - `/aperture:settings` settings UI via `registerSettingsCommand`.

## Key decisions

- Config is global-only (no per-project scope). Aperture is a network-level concern.
- Provider list comes from `getProviders()` in `@mariozechner/pi-ai`, not hardcoded.
- `apiKey` is set to `"-"` because Aperture ignores client-provided keys.
- URLs are normalized on input: `http://` is prepended if missing, trailing `/v1` is stripped (appended at registration time).

## Dependencies

- `@aliou/pi-utils-settings` - Config loader and settings command infrastructure.
- `@mariozechner/pi-ai` - `getProviders()` for the known provider list.
- `@mariozechner/pi-coding-agent` - Extension API, `getSettingsListTheme`.
- `@mariozechner/pi-tui` - TUI components (`Input`, `Key`, `matchesKey`, `FuzzySelector`).

## Publishing

- Manual publish for 0.0.1, then changesets + GitHub Actions for subsequent versions.
- CI runs lint + typecheck on push/PR. Publish workflow triggers after CI succeeds on main.
