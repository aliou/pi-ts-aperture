---
"@aliou/pi-ts-aperture": minor
---

Dedicated mode: model capability metadata and Pi models-store caching.

Dedicated models are now enriched at refresh time instead of registering with flat safe defaults. Capability metadata (context window, output limit, vision input, reasoning, thinking levels) resolves from Pi's native model registry first, then the models.dev catalog as a fallback, then safe defaults. Gateway pricing still wins for costs, and `~/.pi/agent/models.json` remains the user-side override.

Model discovery and caching migrated from a custom disk cache to Pi's `refreshModels` hook and per-provider models store (`~/.pi/agent/models-store.json`). Pi restores the previous catalog synchronously at startup (including offline) and revalidates from the gateway on `session_start` and settings saves. Upstream API routing is now embedded on each model config as `upstreamApi` and persists through the store.

Behavior changes:

- Requires Pi >= 0.80.8 (peer dependency floor raised from 0.80.4).
- Offline starts silently restore models from the models store instead of warning.
- Failed gateway fetches surface through Pi's model-refresh error handling and fall back to the stored catalog.
- The old cache file (`~/.pi/agent/cache/aperture-dedicated-models.json`) is no longer read or written.
