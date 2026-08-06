---
"@aliou/pi-ts-aperture": patch
---

Add Pi coding-agent 0.84 compatibility for the dedicated provider refresh:

- Catalog reads and persistence now go through a runtime shape-detection shim (`src/refresh-store-compat.ts`) that uses the 0.84 `context.stored` snapshot and `context.publish({ persist })` transaction when available, and falls back to the legacy `context.store` read/write on older hosts. The `readStoredModels` store reader became `storedCatalogModels(snapshot, catalogKey)`, preserving catalog-key validation and cache-only restore when the network is disallowed.
- `ctx.modelRegistry.refresh()` now handles the 0.84 `ModelsRefreshResult`, notifying when `result.errors` contains the `aperture` provider error, while still catching thrown errors and staying compatible with pre-0.84 hosts that resolve with void.

Peer ranges keep their existing floors and now also support 0.84.
