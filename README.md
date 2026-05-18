![banner](https://assets.aliou.me/github/aliou/pi-ts-aperture/banner.png)

# pi-ts-aperture

Route Pi LLM providers through [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on your tailnet.

Aperture handles API key injection and request routing server-side. This extension integrates Pi with Aperture in two modes: **dedicated** (standalone provider) or **proxy** (reroute existing providers).

## Install

```bash
pi install npm:@aliou/pi-ts-aperture
```

## First run

After installing, run the onboarding wizard:

```
/aperture:onboarding
```

[![Onboarding walkthrough](https://assets.aliou.me/pi-extensions/demos/aperture/v0.6.0/onboarding.gif)](https://assets.aliou.me/pi-extensions/demos/aperture/v0.6.0/onboarding.mp4)

The wizard walks you through:

1. Aperture base URL, with a `/v1/models` health check (e.g. `ai.your-tailnet.ts.net`)
2. Mode selection: dedicated or proxy
3. Provider selection:
   - Dedicated mode: choose which Aperture gateway providers to include
   - Proxy mode: choose which existing Pi providers to route, with optional gateway model verification
4. Recap and save

You can change everything later with:

```
/aperture:settings
```

## Modes

### Dedicated (default)

Registers a standalone `aperture` provider whose model list comes from the Aperture gateway. You can include all gateway providers or filter to specific gateway providers during onboarding or in settings.

Model IDs use the format `{providerId}::{modelId}` (for example, `anthropic::claude-sonnet-4-20250514`). The provider prefix is stripped before requests reach Aperture.

Dedicated mode uses the `openai-completions` API for all models. Because Aperture does not expose every Pi model capability yet, models use shared defaults on first load: 128k context, 8k max output, text input, and no reasoning. Gateway pricing is mapped to Pi costs when Aperture returns pricing data.

Gateway model data is cached locally so models appear instantly on startup, then refreshed in the background.

#### Sync model capabilities

When models are using default capabilities, a `sync-aperture-models` skill becomes available and a warning appears on session start.

Run the skill to look up real capabilities (context window, max tokens, reasoning, input modalities, costs) from upstream providers and models.dev, then update `~/.pi/agent/models.json`. User-defined model entries in `models.json` take precedence over gateway defaults and persist across restarts.

Once all models have real capabilities, the skill and warning disappear automatically.

### Proxy

Reroutes existing Pi providers (anthropic, openai, etc.) through Aperture. Each provider keeps its own model definitions and settings. Only the base URL, API key, and headers are overridden.

Proxy mode is useful when you want Pi's native per-provider model configuration but want requests to go through Aperture for server-side credentials and routing.

## Commands

| Command | Description |
|---|---|
| `/aperture:onboarding` | Onboarding wizard. Only available until setup is marked complete. |
| `/aperture:settings` | Settings UI to update connection, mode, proxy providers, dedicated provider filters, and onboarding status. |

## How it works

### Request routing

Both modes send requests to Aperture with provenance headers:

- `Referer: https://pi.dev`
- `X-Title: npm:@aliou/pi-ts-aperture`
- `x-session-id` for grouping requests in the Aperture dashboard

In dedicated mode, `x-upstream-provider-id` is also sent so Aperture routes to the correct upstream provider.

### Proxy mode

For each configured upstream provider, the extension calls `registerProvider` with:

- `baseUrl` set to your Aperture URL + `/v1`
- `apiKey` set to `"-"` because Aperture injects upstream credentials server-side

Optional gateway model verification can warn when configured Pi models are missing from the Aperture gateway. Removed providers are unregistered with a notification to `/reload` for native provider recovery.

### Dedicated mode

Dedicated mode fetches models from Aperture `/v1/models`, merges them with user-defined `providers.aperture.models` from `~/.pi/agent/models.json`, and registers an `aperture` provider.

User-defined models from `models.json` take precedence over gateway defaults, so custom capabilities such as reasoning, context window, max output, input modalities, and costs are preserved across restarts.

Dedicated mode also caches gateway models in the global config. On startup, cached models are registered immediately, then the gateway is refreshed in the background and the cache is updated if the model list changed.

## Configuration

Configuration is saved globally to `~/.pi/agent/extensions/aperture.json`.

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
