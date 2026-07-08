---
"@aliou/pi-ts-aperture": patch
---

Swallow transient gateway failures in `checkMissingModels`. The proxy missing-model warning is fire-and-forget, so a 5s abort timeout or network error from `ApertureClient.providers()` (called when no cached provider list is passed in) rejected the promise and crashed Pi via `uncaughtException`. Gateway fetch errors now return early and silently, matching `enabledModelIds`'s existing swallow-and-fallback behavior.
