---
"@aliou/pi-ts-aperture": patch
---

Fix `Mismatched api: anthropic-messages expected openai-completions` when a proxy provider has an `api` override (e.g. routing neuralwatt models through the anthropic-messages surface). With an override the gateway owns the protocol translation, so proxy mode now streams through the pi-ai api registry (like dedicated mode) instead of delegating the rewritten model to the upstream provider, whose stream layer may be pinned to its own api. Delegation is unchanged without an override. The shared registry-dispatch helpers move from `extensions/aperture/dedicated/api-routing.ts` to `extensions/shared/api-routing.ts`.
