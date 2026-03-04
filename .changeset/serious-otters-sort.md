---
"@aliou/pi-ts-aperture": minor
---

Refactor the Aperture routing implementation into focused modules and improve startup model discovery.

### What changed

- Split the previous large `src/index.ts` into a clearer architecture:
  - `src/providers/aperture.ts` for routing/bootstrap/model refresh logic
  - `src/providers/model-config.ts` for model synthesis/merge helpers
  - `src/lib/aperture-api.ts` for Aperture API discovery calls
  - `src/state/provider-model-cache.ts` for in-memory model cache state
- Keep `src/index.ts` as orchestration only (load config, register hooks/commands).
- Preserve and explicitly inject provenance headers when routing through Aperture:
  - `Referer: https://pi.dev`
  - `X-Title: npm:@aliou/pi-ts-aperture`
- Fix active model refresh timing by awaiting model re-resolution before request execution.
- Improve OpenRouter CLI model selection reliability by bootstrapping discovered models from Aperture when needed.

### Why minor

This release introduces observable behavior improvements (model availability/routing reliability and header behavior) in addition to internal refactoring.
