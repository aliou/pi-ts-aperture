---
"@aliou/pi-ts-aperture": minor
---

Add per-provider `keepGatewayModelsOnly` in `proxy.upstreamProviders` (default `false`). When enabled on a proxied provider, its registered models are filtered down to the ones the Aperture gateway actually serves (same `/api/providers` + `/v1/models` cross-reference as `shouldCheckGatewayModels`), instead of rerouting every local model and failing at request time. The drop is reported once per sync with per-provider counts, providers with no models left are skipped like providers with no local models, and the catalog fetch fails open. Toggling the flag off restores the full model list on the next resync. Also editable per provider from the Proxy tab in `/aperture:settings`.
