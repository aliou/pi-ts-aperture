---
"@aliou/pi-ts-aperture": minor
---

Add `provider` mode. The extension now supports two mutually exclusive modes:

- `override` (default, previous behavior): re-registers existing providers
  (openai, anthropic, ...) so their traffic goes through the Aperture gateway.
- `provider`: registers a new provider named `aperture` whose model list is
  discovered from `GET <baseUrl>/v1/models` on the gateway. All model metadata
  comes from the gateway response; per-token pricing is converted to Pi's
  per-million convention. Fields the gateway does not emit (context window,
  max tokens, input modalities, reasoning flag) are left unset.

The mode can be toggled via `/aperture:setup` (new wizard step) or
`/aperture:settings`. In `provider` mode the gateway-checked providers and
routed providers lists are hidden because the gateway is the sole source of
truth.
