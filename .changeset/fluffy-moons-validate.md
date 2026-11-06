---
"@aliou/pi-ts-aperture": patch
---

Validate gateway responses with `@earendil-works/pi-schema` instead of `typebox` in the `./provider` entry. `typebox` is no longer a peer dependency, so installing the package next to `@earendil-works/pi-ai` is enough to import `@aliou/pi-ts-aperture/provider`. The pi peer dependencies now accept `>=1.5.0` instead of pinning `pi-ai` to `1.5.0`.
