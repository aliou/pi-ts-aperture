![banner](https://assets.aliou.me/pi-extensions/banners/pi-ts-aperture.png)

# pi-ts-aperture

Route Pi LLM providers through [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on your tailnet.

Aperture handles API key injection and request routing server-side. This extension integrates Pi with Aperture in two modes: **dedicated** (standalone provider) or **proxy** (reroute existing providers).

## Setup

```bash
pi install npm:@aliou/pi-ts-aperture
```

Then run the setup wizard:

```
/aperture:setup
```

The wizard walks you through:
1. Aperture base URL (e.g. `ai.your-tailnet.ts.net`)
2. Mode selection: dedicated or proxy
3. Proxy provider selection (only in proxy mode)
4. Recap and save

Configuration is saved globally to `~/.pi/agent/extensions/aperture.json`.

## Modes

### Dedicated (default)

Registers a standalone `aperture` provider whose model list comes directly from the Aperture gateway. All gateway models appear under one provider. Uses `openai-completions` API for all models.

### Proxy

Reroutes existing Pi providers (anthropic, openai, etc.) through Aperture. Each provider keeps its own model definitions and settings. Only the base URL and API key are overridden.

## Commands

| Command | Description |
|---|---|
| `/aperture:setup` | Onboarding wizard (only available before first setup) |
| `/aperture:settings` | Settings UI to update connection, mode, providers, and onboarding status |

## How it works

### Proxy mode

For each configured upstream provider, the extension calls `registerProvider` with:

- `baseUrl` set to your Aperture URL + `/v1`
- `apiKey` set to `"-"` (Aperture injects upstream credentials server-side)
- provenance headers: `Referer: https://pi.dev`, `X-Title: npm:@aliou/pi-ts-aperture`
- `x-session-id` header for grouping requests in the Aperture dashboard

### Dedicated mode

Fetches models from Aperture `/v1/models`, registers an `aperture` provider with:
- Model IDs prefixed with provider when available (e.g. `anthropic/claude-3.5-sonnet`)
- `openai-completions` API for all models
- `x-session-id` and `x-upstream-provider-id` headers for routing

## Configuration

```json
{
  "baseUrl": "http://ai.your-tailnet.ts.net",
  "mode": "dedicated",
  "onboardingDone": true,
  "proxy": {
    "upstreamProviders": [
      { "id": "anthropic", "shouldCheckGatewayModels": true }
    ]
  },
  "dedicated": {}
}
```

## Requirements

- A Tailscale tailnet with Aperture configured
- The device running Pi must be on the tailnet (or otherwise able to reach your Aperture endpoint)
- Use the URL/scheme that matches your deployment (`http://` or `https://`)
