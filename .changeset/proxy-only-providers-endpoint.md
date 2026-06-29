---
"@aliou/pi-ts-aperture": minor
---

Filter disabled gateway providers out of proxy and dedicated flows.

`/api/providers` lists every provider regardless of its `disabled` flag, so
disabled providers and their models leaked into the proxy settings/onboarding
checklist, the dedicated provider list, the dedicated model registration,
and the proxy gateway-model check.

`ApertureClient.providers()` now also fetches `/v1/models` (which only lists
models for enabled providers) and:

- drops any provider whose models are all absent from `/v1/models`, and
- intersects each surviving provider's `models` with `/v1/models`, so only
  callable models are exposed.

Because every consumer (proxy settings, proxy onboarding, dedicated settings,
dedicated onboarding, dedicated runtime, `checkMissingModels`, `health`)
goes through `providers()`, all of them now exclude disabled providers
without further changes. If `/v1/models` is unreachable, `providers()` falls
back to the unfiltered `/api/providers` result so a transient models-endpoint
failure never blocks the rest of the client.
