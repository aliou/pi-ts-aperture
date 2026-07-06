---
"@aliou/pi-ts-aperture": patch
---

Wire `/v1/models` pricing into dedicated provider model costs.

Dedicated mode was registering every gateway model with zero cost because `/v1/models` was only used as an enabled-model filter and its `pricing` object was discarded. The client now retains each model's pricing on `modelInfoById`, and the dedicated runtime passes it through to `buildDefaultModelConfig`, so per-token USD values are converted to per-million costs on registered models and persisted to the dedicated models cache.
