---
"@aliou/pi-ts-aperture": patch
---

Add `registryModels` and `providers` options to `createApertureProvider`. `registryModels` passes a host-side model catalog whose matching entries supply metadata (name, reasoning, vision input, thinking levels, limits, `compat`) and native upstream base URLs, the same way the extension merges Pi's registry. `providers` selects which gateway providers to include and sets per-provider api overrides.
