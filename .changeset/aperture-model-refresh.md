---
"@aliou/pi-ts-aperture": patch
---

Fix timing issue where active model was cached before before_agent_start event fired. Now re-resolves the active model after updating the registry to ensure Aperture routing is applied correctly.
