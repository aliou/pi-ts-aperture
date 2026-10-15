---
"@aliou/pi-ts-aperture": patch
---

Emit `aperture:models:synced` after the startup and settings model sync settles: once the proxy providers are re-registered with the served catalog and the networked refresh completes, the extension broadcasts on the shared extension event bus. Consumers (pi-rig's virtual-models hook) re-prune alias families the gateway no longer serves without waiting for a user interaction, so a stale session-start snapshot cannot leave a dead alias wedged as the selected or default model.
