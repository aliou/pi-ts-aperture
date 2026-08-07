---
"@aliou/pi-ts-aperture": patch
---

Fix dedicated-mode requests failing for models whose upstream rejects the
`developer` role (e.g. neuralwatt's GLM/Kimi/DeepSeek).

The model-id fallback in the Pi registry metadata resolver refused to copy
any `compat` fields, so dedicated mode rebuilt these models with no compat at
all. Pi's openai-completions adapter then defaulted to `supportsDeveloperRole:
true` and `maxTokensField: "max_completion_tokens"`, sending a `developer`
system message that the upstream API rejects.

The fallback now copies the model-intrinsic compat fields
(`supportsDeveloperRole`, `maxTokensField`,
`requiresReasoningContentOnAssistantMessages`), which are properties of the
model family and consistent across providers in the registry. Endpoint-specific
quirks (`supportsStore`, `supportsLongCacheRetention`, `deferredToolsMode`,
`zaiToolStream`, ...) stay out of a fallback match.
