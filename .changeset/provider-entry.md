---
"@aliou/pi-ts-aperture": minor
---

Add a standalone `createApertureProvider` entry point, exported at `@aliou/pi-ts-aperture/provider`. It returns a pi-ai `Provider` that fetches its catalog from an Aperture gateway's `/v1` surface — no coding agent, no config file, everything via options. The gateway `baseUrl` is required; provenance headers (Referer plus per-request `x-session-id`) are on by default and configurable via `provenance`.
