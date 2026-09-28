---
"@aliou/pi-ts-aperture": patch
---

Fix model catalog refresh for proxied providers with a `models.json` override. Keep inherited provider methods anchored to the original provider so Pi's recomposed `refreshModels` cannot call itself after the gateway catalog sync.
