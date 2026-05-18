---
"@aliou/pi-ts-aperture": minor
---

Dynamic skill registration and user model merge for dedicated mode

- `sync-aperture-models` skill is only exposed when models have default capabilities (128k/8k/no reasoning). Once synced, the skill disappears automatically until new models are added.
- Skill content is inlined in code and written to a temp directory — no relative path resolution issues across install locations.
- User-defined models from `models.json` take precedence over gateway defaults. The extension reads `providers.aperture.models` and merges them, so custom capabilities (reasoning, context window, etc.) are preserved across restarts.
- Warning notification on session start when models use default capabilities, plus a nudge after dedicated mode onboarding.
- Fixed cost units: `models.json` uses per-million tokens (matching Pi docs), Aperture gateway pricing is per-token and is multiplied by 1,000,000.
