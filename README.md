![banner](https://assets.aliou.me/github/aliou/pi-ts-aperture/banner.png)

# pi-ts-aperture

Route Pi LLM providers through [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on your tailnet.

Aperture handles API key injection and request routing server-side. This extension integrates Pi with Aperture in two modes: **dedicated** (standalone provider) or **proxy** (reroute existing providers).

## Setup

```bash
pi install npm:@aliou/pi-ts-aperture
```

Then run the setup wizard:

```
/aperture:onboarding
```

The wizard walks you through:

1. Aperture base URL, with a `/v1/models` health check (e.g. `ai.your-tailnet.ts.net`)
2. Mode selection: dedicated or proxy
3. Provider selection:
   - Dedicated mode: choose which Aperture gateway providers to include
   - Proxy mode: choose which existing Pi providers to route, with optional gateway model verification
4. Recap and save

Configuration is saved globally to `~/.pi/agent/extensions/aperture.json`.

## Modes

### Dedicated (default)

Registers a standalone `aperture` provider whose model list comes from the Aperture gateway. You can include all gateway providers or filter to specific gateway providers during onboarding or in settings.

Dedicated mode uses the `openai-completions` API for all models. Because Aperture does not expose every Pi model capability yet, models use shared defaults: 128k context, 8k max output, text input, and no reasoning. Gateway pricing is mapped to Pi costs when Aperture returns pricing data.

### Proxy

Reroutes existing Pi providers (anthropic, openai, etc.) through Aperture. Each provider keeps its own model definitions and settings. Only the base URL, API key, and headers are overridden.

Proxy mode is useful when you want Pi's native per-provider model configuration but want requests to go through Aperture for server-side credentials and routing.

## Commands

| Command | Description |
|---|---|
| `/aperture:onboarding` | Onboarding wizard. Only available until setup is marked complete. |
| `/aperture:settings` | Settings UI to update connection, mode, proxy providers, dedicated provider filters, and onboarding status. |

## How it works

### Proxy mode

For each configured upstream provider, the extension calls `registerProvider` with:

- `baseUrl` set to your Aperture URL + `/v1`
- `apiKey` set to `"-"` because Aperture injects upstream credentials server-side
- provenance headers: `Referer: https://pi.dev`, `X-Title: npm:@aliou/pi-ts-aperture`
- `x-session-id` header for grouping requests in the Aperture dashboard

Optional gateway model verification can warn when configured Pi models are missing from the Aperture gateway.

### Dedicated mode

Fetches models from Aperture `/v1/models`, then registers an `aperture` provider with:

- Model IDs prefixed with the upstream provider ID using `::` (for example, `anthropic::claude-3.5-sonnet`)
- `openai-completions` API for all models
- `x-session-id` and `x-upstream-provider-id` headers for routing
- Model costs derived from Aperture pricing when available

Dedicated mode also caches gateway models in the global config. On startup, cached models are registered immediately, then the gateway is refreshed in the background and the cache is updated if the model list changed.

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
  "dedicated": {
    "providers": [
      { "id": "anthropic", "name": "Anthropic", "enabled": true },
      { "id": "openai", "name": "OpenAI", "enabled": true },
      { "id": "google", "name": "Google", "enabled": false }
    ]
  }
}
```

`dedicated.cachedModels` may also be persisted by the extension. It is an internal startup cache, so you normally do not need to edit it by hand.

## Requirements

- A Tailscale tailnet with Aperture configured
- The device running Pi must be on the tailnet, or otherwise able to reach your Aperture endpoint
- Use the URL/scheme that matches your deployment (`http://` or `https://`)
