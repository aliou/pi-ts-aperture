---
"@aliou/pi-ts-aperture": patch
---

fix(dedicated): cache models so the aperture provider restores instantly on startup

Dedicated mode only discovered models after the gateway fetch in session_start,
so scoped models (aperture/<id>) could not be restored at startup and surfaced
"No models match pattern" warnings. Register the provider synchronously from a
stale-while-revalidate disk cache in the extension factory body, then
revalidate from the live gateway and re-register with fresh models on
session_start/onSync. Cache lives at
getAgentDir()/cache/aperture-dedicated-models.json and stores models plus the
per-model upstream API route map; it is ignored when the gateway URL changes
until revalidation rewrites it.
