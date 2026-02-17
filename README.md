# pi-ts-aperture

Route Pi LLM providers through [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on your tailnet.

Aperture handles API key injection and request routing server-side. This extension overrides the base URL for selected providers so all LLM requests go through your Aperture instance instead of directly to provider APIs.

## Setup

```bash
pi install @aliou/pi-ts-aperture
```

Then run the setup wizard:

```
/aperture:setup
```

This will prompt you for:
1. Your Aperture base URL (e.g. `ai.your-tailnet.ts.net`)
2. Which providers to route through Aperture (fuzzy searchable, multi-select)

Configuration is saved globally to `~/.pi/agent/extensions/aperture.json`.

## Commands

| Command | Description |
|---|---|
| `/aperture:setup` | Interactive wizard to configure Aperture URL and providers |
| `/aperture:settings` | Settings UI to update base URL and provider list |

## How it works

For each configured provider, the extension calls `registerProvider` with:
- `baseUrl` set to your Aperture URL + `/v1`
- `apiKey` set to `"-"` (Aperture ignores client keys, it injects its own)

This means all requests for those providers are routed through Aperture, which handles authentication, logging, and cost tracking on its end.

## Requirements

- A Tailscale tailnet with Aperture configured
- The device running Pi must be on the tailnet
- Use HTTP, not HTTPS, for the Aperture URL (WireGuard handles encryption)
