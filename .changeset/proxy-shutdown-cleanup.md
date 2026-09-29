---
"@aliou/pi-ts-aperture": patch
---

Remove proxy provider wrappers on session shutdown so reloads apply gateway changes without retaining stale wrappers. Prevent pending catalog fetches from restoring wrappers after shutdown.
