---
"@aliou/pi-ts-aperture": patch
---

Dedicated mode now infers the gateway base URL per model from Pi's native model registry, fixing Z.ai (and other non-`/v1` upstreams) in dedicated mode. Also corrects the proxy-mode inference rule shipped in the previous release.

Both modes now share one rule: a model registers against the gateway root only when its upstream base URL ends in a version segment that is not `/v1` (e.g. Z.ai `/api/coding/paas/v4`). Everything else — root baseurls (Mistral, DeepSeek) and `/v1` baseurls (OpenAI, Groq, OpenRouter) — uses `gateway/v1`, Aperture's standard `/v1/chat/completions` endpoint.

Why: Aperture appends the incoming request path to the provider's `baseurl`. A standard `/v1/chat/completions` client produces `/v4/v1/chat/completions` against a `/v4` baseurl (Z.ai) → 404. Root baseurls and `/v1` baseurls work fine at `/v1/chat/completions` and have no `/chat/completions` route at the gateway root.

Dedicated mode cross-references each gateway model against Pi's registry (by provider id, then model id) to read the upstream base URL; the resolved per-model base URLs are baked into the on-disk cache so `registerCached` replays them before the first revalidation. Gateway providers with no native Pi match keep `gateway/v1`.

The previous proxy release routed any non-`/v1` baseurl (including root baseurls like Mistral's) to the gateway root, where Aperture has no route. This corrects that to the narrower version-segment rule.

Fixes #27.
