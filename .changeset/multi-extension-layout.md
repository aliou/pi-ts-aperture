---
"@aliou/pi-ts-aperture": minor
---

Refactor Aperture into a single extension with independent dedicated and proxy capabilities.

- Replaced the legacy `mode` setting with independent `dedicated.enabled` and `proxy.enabled` flags. Existing configs are migrated automatically.
- Kept dedicated enabled by default while allowing proxy to be enabled at the same time.
- Moved Pi extension code under `extensions/aperture/` and kept Pi-agnostic Aperture API/provider mapping code under `src/`.
- Switched provider discovery to Aperture's `/api/providers` and `/aperture/config` endpoints.
- Added shared provider mapping so onboarding and settings use the same local Pi registry matching behavior.
- Improved proxy matching with base URL child-path matching and provider ID fallback, including the Codex root URL special case.
- Removed dedicated model ID prefixes, persisted gateway model cache, temporary model-sync onboarding skill/tools, and `x-upstream-provider-id` request headers.
- Updated onboarding to choose dedicated, proxy, or both, then reload Pi after saving so selected providers register cleanly.
- Updated settings to edit connection, capabilities, proxy providers, dedicated provider filters, onboarding state, and onboarding extension state.
