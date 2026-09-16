---
"@aliou/pi-ts-aperture": patch
---

Dedicated mode: exclude passthrough providers (`requires_client_auth`) from the dedicated catalog and from the settings/onboarding provider lists. Their models cannot be called through the dedicated provider since it never forwards a client credential. Proxy mode still lists them and reconciles native auth.
