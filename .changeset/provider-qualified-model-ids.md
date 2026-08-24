---
"@aliou/pi-ts-aperture": minor
---

Route requests with provider-qualified model ids (`provider/model-id`), which the gateway forwards verbatim, instead of relying on its bare-id resolution. Proxy mode rewrites the id at stream dispatch (the model picker still shows bare ids); dedicated mode prefixes ids when building the catalog and bumps the catalog cache key so stale bare-id snapshots are not restored.
