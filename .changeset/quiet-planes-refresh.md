---
"@aliou/pi-ts-aperture": patch
---

Emit `aperture:models:synced` only after a final cache-only registry refresh scoped to the providers this extension registers, so consumers of the event can trust the availability snapshot to include the final proxy and dedicated provider registrations.
