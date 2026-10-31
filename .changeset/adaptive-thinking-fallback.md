---
"@aliou/pi-ts-aperture": patch
---

Dedicated mode: keep adaptive thinking for Anthropic models served under a custom gateway provider id.

When the gateway provider id is not one of Pi's native provider ids (for example `anthropic-api-admins` instead of `anthropic`), model metadata is matched against Pi's registry by model id only, and that match copied just the model-intrinsic `compat` fields. `forceAdaptiveThinking` was not among them, so models that only accept adaptive thinking, such as `claude-opus-5-5`, were sent `thinking.type.enabled` and the request failed with a 400. The flag describes the request format the model itself requires, so it now carries over on a model-id match.
