---
"@aliou/pi-ts-aperture": minor
---

Make provenance headers configurable and follow Pi's telemetry configuration. The `Referer: https://pi.dev` and `x-session-id` headers injected on every provider request can now be turned off with the new `shouldSendProvenanceHeaders` config option (default `true`, also exposed in `/aperture:settings`). Independent of that flag, the headers are skipped whenever the user opted out of Pi telemetry (`PI_TELEMETRY` env override or the `enableInstallTelemetry` setting, mirroring the gate Pi core uses for its own provider attribution headers). Users who opted out of Pi telemetry will see the headers stop; everyone else sees no change.
