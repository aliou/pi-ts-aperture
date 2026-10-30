---
"@aliou/pi-ts-aperture": minor
---

Add `generateAdditionalModelsFromGateway` (Proxy tab: "Add gateway-only models"). When on, a proxied provider also registers the models the gateway serves but Pi's catalog does not list: they are synthesized from the gateway catalog (cost, token limits, API) plus Pi's registry metadata and their name carries an ` (uncatalogued)` suffix in the model picker. They live in memory only — rebuilt on every sync and never written to Pi's models store — so they cannot be selected as the agent's default model.

Registry metadata resolution gains an opt-in same-provider family fallback (`siblingMatch`) and caller-supplied `registryProviderIds`, so a gateway-only snapshot id such as `together/kimi-k3-1017` inherits capabilities and endpoint quirks from `together/kimi-k3` while keeping its own name and gateway cost. Dedicated entries for the same models opt in alongside the proxy, so both providers describe a model identically.

Internal method`checkModelDrift` (renamed from old name `checkMissingModels`): alongside the existing forward warning (local models the gateway does not serve), it warns once per provider about gateway models the Pi model list does not expose, naming the flag and settings location that fix it. Providers with `generateAdditionalModelsFromGateway` on are excluded, since it removes the drift by construction.
