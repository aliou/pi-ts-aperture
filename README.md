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
2. Mode — `override` or `provider` (see below)
3. Providers to route through Aperture (only in `override` mode)

Configuration is saved globally to `~/.pi/agent/extensions/aperture.json`.

## Modes

The extension supports two mutually exclusive modes.

### `override` (default)

Re-registers existing providers (`openai`, `anthropic`, ...) so their
requests are routed through your Aperture gateway. Model definitions are
inherited from whichever extension originally registered the provider --
Aperture never touches them. Requires the upstream provider extensions to
be installed so that their models are visible in the registry.

### `provider`

Registers a new provider named `aperture` whose model list is discovered
from `GET <baseUrl>/v1/models` on the gateway. No upstream provider
extensions are required. Model metadata (including per-million pricing,
converted from Aperture's per-token wire format) comes entirely from the
gateway response; fields the gateway doesn't emit (context window, max
tokens, input modalities, reasoning flag) are left unset.

## Commands

| Command | Description |
|---|---|
| `/aperture:setup` | Interactive wizard to configure Aperture URL and routed providers |
| `/aperture:settings` | Settings UI to update URL and routed provider list |

## How it works

For each registered provider (the configured list in `override` mode, or the
single `aperture` provider in `provider` mode), the extension calls
`registerProvider` with:

- `baseUrl` set to your Aperture URL + `/v1` (OpenAI-compatible surface used by Pi provider configs)
- `apiKey` set to `"-"` (Aperture injects upstream credentials server-side)
- provenance headers:
  - `Referer: https://pi.dev`
  - `X-Title: npm:@aliou/pi-ts-aperture`

In `provider` mode, the extension additionally calls
`GET <baseUrl>/v1/models` at load time and whenever configuration changes to
enumerate available models, converting Aperture's per-token pricing strings
into Pi's per-million-tokens cost convention.

## Requirements

- A Tailscale tailnet with Aperture configured
- The device running Pi must be on the tailnet (or otherwise able to reach your Aperture endpoint)
- Use the URL/scheme that matches your deployment (`http://` or `https://`)
