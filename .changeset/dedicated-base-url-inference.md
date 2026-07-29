---
"@aliou/pi-ts-aperture": minor
---

Dedicated mode now infers the gateway base URL per model from Pi's native model registry, fixing non-`/v1` upstreams like Z.ai in dedicated mode.

Previously dedicated mode registered every OpenAI-compat model at `gateway/v1`, so Z.ai (`/api/coding/paas/v4`) produced `/v4/v1/chat/completions` and 404'd. The extension now cross-references each gateway model against Pi's registry (by provider id, then model id) to read the upstream base URL, then applies the shared `shouldUseGatewayRoot` rule: providers whose upstream base URL ends in a non-`/v1` version segment (Z.ai `/v4`) register the gateway root; root baseurls (Mistral, DeepSeek) and `/v1` baseurls (OpenAI, Groq) keep `gateway/v1`. Gateway providers with no native Pi match keep `gateway/v1`. The inference runs at sync time and the resolved per-model base URLs are baked into the on-disk cache so `registerCached` replays them before the first revalidation.

Fixes #27 (dedicated mode).
