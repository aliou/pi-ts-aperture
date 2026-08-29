---
"@aliou/pi-ts-aperture": patch
---

Fix proxy mode sending a duplicated model-id prefix after `/reload`. Pi's model runtime keeps the previously-registered proxy wrapper across a reload, while the extension factory re-runs with a fresh runtime, so the stale wrapper was wrapped again and the request model id gained one `provider/` prefix per reload (e.g. `openai-codex/openai-codex/gpt-5.5`), making the gateway return 404 `no route found`. Model-id qualification is now idempotent: an id that is already provider-prefixed is left unchanged instead of being prefixed again.
