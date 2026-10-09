---
"@aliou/pi-ts-aperture": patch
---

Proxy mode no longer rewrites classifier and image models to the gateway chat api and URL. They keep the upstream provider's own api and baseUrl, so provider classifiers such as Neuralwatt's `clef-flash` work again.
