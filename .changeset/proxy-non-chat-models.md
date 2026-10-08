---
"@aliou/pi-ts-aperture": patch
---

Fix proxy mode breaking non-chat models. `serveGatewayModels` rewrote every model from `getAllModels()` to the gateway api and base URL, which reclassified provider classifier models under a chat api and broke their one-shot dispatch. Non-chat models now pass through the proxy wrapper untouched — they keep their own api and upstream base URL and route directly to the upstream provider.
