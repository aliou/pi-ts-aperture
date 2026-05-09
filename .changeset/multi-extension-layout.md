---
"@aliou/pi-ts-aperture": minor
---

Two-mode architecture with onboarding wizard and dedicated provider selection

**Breaking**: Config shape changed. Existing configs are auto-migrated.

- Two modes: **dedicated** (standalone `aperture` provider from gateway models) and **proxy** (reroute existing Pi providers through Aperture)
- Interactive onboarding wizard (`/aperture:onboarding`) with: URL health check, mode selection, provider filtering, and recap
- Dedicated mode: select which Aperture gateway providers to include via searchable, scrollable checklist
- Proxy mode: select upstream providers to route through Aperture with optional gateway model verification (Ctrl+G)
- Config is global-only; `onboardingDone` gate prevents setup command registration after completion
- Notification on session start when onboarding is pending
- Gateway pricing (`input`, `input_cache_read`, `input_cache_write`, `output`) parsed and mapped to Pi cost fields for dedicated mode models
- Both modes reload with countdown after onboarding
- Legacy v0.5 config auto-migrated to new shape with `onboardingDone: true`
