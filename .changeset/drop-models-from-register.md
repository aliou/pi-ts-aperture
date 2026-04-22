---
"@aliou/pi-ts-aperture": patch
---

Drop `models` from `registerProvider` call. Rely on the baseUrl-override path instead, which preserves built-in model definitions (reasoning, compat, thinking levels) and only updates the endpoint URL.
