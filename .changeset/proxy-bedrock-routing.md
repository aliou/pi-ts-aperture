---
"@aliou/pi-ts-aperture": patch
---

Route proxy-mode Bedrock providers through Aperture's `/bedrock` surface and consolidate gateway base-URL routing into one shared resolver.

Proxy mode previously inlined only `shouldUseGatewayRoot`, which is `false` for `bedrock-converse-stream`, so a proxied Bedrock provider was registered at the OpenAI-shaped `gateway/v1` and failed with a protocol error. Aperture's native Bedrock-compatible surface lives at `gateway/bedrock`. Dedicated mode already routed Bedrock to `/bedrock`; proxy now matches it.

The per-API resolver `getBaseUrlForApi` (Anthropic/Codex root, Gemini `/v1beta`, Vertex `/v1`, Bedrock `/bedrock`, OpenAI-SDK root-vs-`/v1` inference) moves from `extensions/aperture/dedicated/api-routing.ts` to `src/base-url-routing.ts`, the shared home already documented for this logic. Both proxy and dedicated now call it, so the two modes can no longer drift.

Side effect of the consolidation: a proxied Gemini provider now routes to `/v1beta` (matching dedicated) instead of `/v1`. This brings proxy into line with dedicated's already-shipped behavior.
