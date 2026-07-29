---
"@aliou/pi-ts-aperture": patch
---

Corrects the proxy-mode gateway-base-URL inference rule introduced in the previous release.

The previous rule routed any upstream base URL that did not end in `/v1` to the gateway root, including root baseurls (Mistral, DeepSeek). Aperture has no `/chat/completions` route for those providers, so proxy requests to them 404'd.

The corrected rule: a model uses the gateway root only when its upstream base URL ends in a version segment that is not `/v1` (e.g. Z.ai `/api/coding/paas/v4`), because Aperture would otherwise double the version (`/v4/v1/chat/completions`). Root baseurls and `/v1` baseurls (OpenAI, Groq, OpenRouter) keep `gateway/v1`, Aperture's standard `/v1/chat/completions` endpoint.

The inference logic is extracted to `src/base-url-routing.ts` (`shouldUseGatewayRoot`) so dedicated mode can reuse it.
