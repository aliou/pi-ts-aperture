---
"@aliou/pi-ts-aperture": minor
---

Use per-model `supported_endpoints` from `/v1/models` for dedicated-mode API routing.

Aperture's `/v1/models` endpoint now returns a `supported_endpoints` field per model (e.g. `["/v1/chat/completions", "/v1/messages", "/v1/responses"]`), reporting which protocols each individual model supports. The extension previously discarded this field, using only the provider-level `compatibility` map from `/api/providers` to pick one Pi API for all models in a provider.

`ApertureModelInfo` now retains `supported_endpoints` alongside `id` and `pricing`. Dedicated mode's `buildModels()` uses `getApiForEndpoints()` to select the Pi API per model when `supported_endpoints` is present, falling back to the provider-level `compatibility` map for older gateways that don't report it or for APIs not covered by the endpoint mapping (Gemini, Vertex, Bedrock). The preference order (chat completions first, then Anthropic messages, then OpenAI responses) matches the existing `getApiForCompatibility` behavior.

The base-URL routing logic (`getBaseUrlForApi` / `shouldUseGatewayRoot`) is unchanged — `supported_endpoints` reports protocol, not upstream base URL, so the existing upstream-base-URL inference from Pi's registry remains necessary for edge cases like Z.ai (`/api/coding/paas/v4`).

Closes #58.
