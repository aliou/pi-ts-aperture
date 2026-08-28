---
"@aliou/pi-ts-aperture": patch
---

Fix 404s for providers served through URL-path model APIs (Google AI Studio/Gemini, Vertex, Bedrock). Aperture only accepts bare model ids in URL paths, so requests routed through `google-generative-ai`, `google-vertex`, or `bedrock-converse-stream` now send the unqualified model id in both proxy and dedicated modes. Body-carried model APIs (OpenAI chat/responses, Anthropic messages) keep the provider-qualified id used for duplicate disambiguation.
