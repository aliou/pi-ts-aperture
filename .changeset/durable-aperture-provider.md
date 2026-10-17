---
"@aliou/pi-ts-aperture": minor
---

Add experimental pi-durable support: the `/provider` and `/proxy` exports register a standalone Aperture provider or proxy existing providers for use with `@earendil-works/pi-durable`, without loading the Pi extension. The durable implementation keeps its own API client, routing, metadata, classifier handling, and tests; Pi-specific routing, registry metadata, and retry tagging move out of `src/` into `extensions/shared/`.
