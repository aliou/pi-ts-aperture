---
"@aliou/pi-ts-aperture": patch
---

Forward cache tokens reported by the OpenAI Decisions API. `input_tokens_details.cached_tokens` and `cache_write_tokens` now map to `cacheRead` and `cacheWrite` on classifier usage, so cached input is billed at the cache-read rate instead of full price. System One classifiers report only flat input/output token counts and are unaffected.
