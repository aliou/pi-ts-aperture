---
"@aliou/pi-ts-aperture": patch
---

Derive the provider catalog from `/v1/models` instead of `/api/providers`, which requires the admin role. Provider discovery, dedicated model refresh, proxy sync, onboarding, and the settings provider lists now work for `role: user` tailnet identities.
