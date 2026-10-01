---
"@aliou/pi-ts-aperture": minor
---

Add a per-model `reasoningReplay` knob on the dedicated provider path. Prior-turn thinking is now replayed in the field each served template renders (move, never copy), with `templateKwargs` shallow-merged into `chat_template_kwargs`; gateway-declared `reasoning_replay` model metadata wins over the built-in table and fails open to it. This restores chain-of-thought replay from turn 2 on for the NeuralWatt K3 family, deepseek-v4.1-flash, synthetic large models, and GLM-5.3-Flash; knob-less models and non-openai-completions APIs stream byte-identical to before. Also fixes a #102-class hazard: `requiresReasoningContentOnAssistantMessages` is no longer copied through model-id fallback metadata matches (provider-exact matches unchanged).
