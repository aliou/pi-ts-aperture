---
"@aliou/pi-ts-aperture": patch
---

Proxy base URL is now inferred from each provider's upstream base URL instead of a hard-coded API allow-list.

For OpenAI SDK APIs (`openai-completions`, `openai-responses`), providers whose upstream base URL pathname ends in `/v1` (OpenAI, Groq, etc.) register `gateway/v1`, while providers without a terminal `/v1` (Z.ai `/api/coding/paas/v4`, DeepSeek root) register the gateway root. This fixes Z.ai proxy requests hitting `…/v4/v1/chat/completions` instead of `…/v4/chat/completions`.

`anthropic-messages` and `openai-codex-responses` keep their unconditional gateway-root behavior. The inferred upstream base URL is cached per provider so settings reloads keep the decision stable when the live model list has already been rewritten to the gateway.
