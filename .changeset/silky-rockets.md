---
"@aliou/pi-ts-aperture": patch
---

Plug provider unregistration - call pi.unregisterProvider() immediately when providers are removed via setup/settings, instead of warning that a /reload is required. Switch to pi.registerProvider() for registration. Bump peer dep to >=0.55.3.
