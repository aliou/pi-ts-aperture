---
"@aliou/pi-ts-aperture": patch
---

Route proxied Anthropic requests through the Aperture root URL.

Pi's Anthropic adapter appends `/v1/messages` itself, so registering the proxy base URL with `/v1` produced `/v1/v1/messages` and caused 404 responses before the request reached Aperture's model handler.
