---
"@aliou/pi-ts-aperture": patch
---

Default `compat.supportsDeveloperRole` to `false` on chat completions models built by the dedicated catalog when no metadata source sets it. pi-ai guesses `true` for unrecognized providers, which sends `role: "developer"` to hosts that only accept `system` and rejects the request. Metadata still wins.
