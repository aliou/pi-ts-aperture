# pi-ts-aperture

Route Pi LLM providers through [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on your tailnet.

Aperture handles API key injection and request routing server-side. This extension overrides selected providers so requests go through your Aperture gateway instead of directly to upstream provider APIs.

## Setup

```bash
pi install npm:@aliou/pi-ts-aperture
```

Then run the setup wizard:

```
/aperture:setup
```

This prompts for:
1. Aperture base URL (for example `ai.your-tailnet.ts.net`)
2. Providers to route through Aperture (fuzzy searchable, multi-select)

Configuration is saved globally to `~/.pi/agent/extensions/aperture.json`.

## Commands

| Command | Description |
|---|---|
| `/aperture:setup` | Interactive wizard to configure Aperture URL and routed providers |
| `/aperture:settings` | Settings UI to update URL and routed provider list |

## How it works

For each configured provider, the extension calls `registerProvider` with:

- `baseUrl` set to your Aperture URL + `/v1` (OpenAI-compatible surface used by Pi provider configs)
- `apiKey` set to `"-"` (Aperture injects upstream credentials server-side)
- provenance headers:
  - `Referer: https://pi.dev`
  - `X-Title: npm:@aliou/pi-ts-aperture`

Additionally, the extension can bootstrap model IDs discovered from Aperture (`/api/providers`) for providers like OpenRouter so CLI model selection can resolve Aperture-exposed model IDs before the first prompt.

## Requirements

- A Tailscale tailnet with Aperture configured
- The device running Pi must be on the tailnet (or otherwise able to reach your Aperture endpoint)
- Use the URL/scheme that matches your deployment (`http://` or `https://`)
