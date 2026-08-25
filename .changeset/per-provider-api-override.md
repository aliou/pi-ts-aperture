---
"@aliou/pi-ts-aperture": minor
---

Add an optional per-provider `api` override for dedicated and proxy modes (`extensions/shared/config/types.ts`, editable per provider in `/aperture:settings`). A gateway provider that serves more than one compatibility surface (e.g. `openai_chat` + `anthropic_messages`) can now route its models through the chosen Pi API instead of the auto-selected one. Overrides are validated against the provider's compatibility map on every sync/refresh and fall back to auto with a warning when the gateway no longer serves them. Dedicated catalog cache keys now include the override, so catalogs built under a different API are never replayed. In `/aperture:settings`, the Dedicated tab's provider list now opens per-provider submenus (matching the Proxy tab) that hold the include toggle and the API selector.
