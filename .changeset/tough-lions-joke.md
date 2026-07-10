---
"@aliou/pi-ts-aperture": minor
---

Require Pi 0.80.4+ and inject request headers via the `before_provider_headers` hook.

Provenance headers (`Referer`, `X-Title`) and `x-session-id` are now added on every provider request through Pi's `before_provider_headers` hook instead of being baked into provider registration or a custom `streamSimple` wrapper. This fixes `x-session-id` going stale across `/fork`, `/new`, and `/resume` (it was previously captured at registration time). The `streamSimple` wrapper in the proxy runtime is removed entirely; the dedicated runtime's wrapper keeps only API routing.

Peer dependencies now require `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` at `>=0.80.4` (for the hook and the `ProviderHeaders` type); `@earendil-works/pi-tui` is loosened to `*`. The `getApiProvider` import moved to `@earendil-works/pi-ai/compat` following the pi-ai 0.80.0 entrypoint split.
