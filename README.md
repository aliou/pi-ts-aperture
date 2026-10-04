![banner](https://assets.aliou.me/github/aliou/pi-ts-aperture/banner.png)

# pi-ts-aperture

Route Pi LLM providers and MCP tools through [Tailscale Aperture](https://tailscale.com/docs/features/aperture), a managed AI gateway on your tailnet.

Aperture handles API key injection and request routing server-side, so Pi never needs upstream provider credentials. This extension offers three capabilities:

- **Dedicated** (default): a standalone `aperture` provider whose models come from the gateway.
- **Proxy**: reroute existing Pi providers (anthropic, openai, openai-codex, ...) through Aperture.
- **MCP tools**: register the gateway's MCP server with Pi's native MCP support, surfacing them as `mcp__aperture__*`.

## Install

```bash
pi install npm:@aliou/pi-ts-aperture
```

## First run

After installing, run the onboarding wizard:

```
/aperture:onboarding
```

[![Onboarding walkthrough](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/onboarding.gif)](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/onboarding.mp4)

The wizard asks for your Aperture URL (with a health check), lets you pick capabilities and providers, then saves and reloads Pi. You can change everything later with `/aperture:settings`.

## Capabilities

### Dedicated provider (default)

[![Dedicated provider walkthrough](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/dedicated-provider.gif)](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/dedicated-provider.mp4)

Registers a standalone `aperture` provider listing the models your gateway exposes. Include all gateway providers or filter to specific ones, and each model is routed through the Pi API that matches its Aperture compatibility.

Capabilities (context window, vision input, reasoning, thinking levels) come from the first source that knows the model: `~/.pi/agent/models.json`, then Pi's model registry, then [models.dev](https://models.dev), then safe defaults. Costs come from the gateway. The resolved catalog is cached in Pi's models store, so models load instantly on startup, even offline.

### Proxy existing providers

[![Proxy providers walkthrough](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/proxy-providers.gif)](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/proxy-providers.mp4)

Reroutes existing Pi providers through Aperture. Each provider keeps its own model definitions and settings. Aperture injects server-side credentials or forwards Pi's native credential for passthrough providers.

Session messages keep the local model ID so Pi can restore the selected model on resume. For each request, the proxy aligns matching prior assistant turns with the gateway-qualified request ID so Pi preserves reasoning and signatures during replay. Turns from other providers, APIs, or models keep Pi's normal cross-model conversion.

Proxy wrappers are removed on session shutdown and rebuilt on session start. `/reload` applies gateway changes without retaining wrappers from the prior extension load.

OpenAI Responses passthrough routes support Pi's **Sign in with ChatGPT** on Pi 0.99 or later. The extension preserves OpenAI's native base URL so Pi applies its subscription request rules, then redirects HTTP requests to the gateway through a custom fetch. OpenAI API keys use the same route with Pi's normal request parameters. Other routes rewrite the model's base URL to the gateway.

The Proxy tab in `/aperture:settings` lists gateway providers by name. Exact local matches show `disabled` until routed, configured routes show their enabled state, and providers without a local match show `select`. Opening a `select` row goes straight to a searchable local-provider multi-select; submitting opens routing settings. Other rows open routing settings directly. Use **Local Pi providers** in those settings to change the selection. When several local providers share a gateway target, each has its own routing settings. A local provider can use a different gateway id (for example, `anthropic` → `anthropic-oauth`). Optional per-provider verification warns when configured local models are missing from the gateway. Set `keepGatewayModelsOnly: true` on a provider to filter those models out of the model picker entirely.

### MCP tools

[![MCP walkthrough](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/connectors.gif)](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/connectors.mp4)

Aperture can expose MCP tools (GitHub, your own internal tools, ...) at `/v1/mcp`. When enabled, this extension registers that endpoint with Pi's built-in MCP support as the `aperture` server with `deferred` exposure: tools surface as `mcp__aperture__*` and stay out of the system prompt until Pi's `tool_search` loads them.

Enable MCP tools in `/aperture:settings`; the toggle applies on the next `/reload` (registration happens at extension load). Manage the connection with `/mcp`. To pin tools (always declared to the model) or hide them, add a same-name entry to `~/.pi/agent/mcp.json` — a file entry takes precedence over the extension's registration:

```json
{
  "mcpServers": {
    "aperture": {
      "url": "http://ai.pango-lin.ts.net/v1/mcp",
      "exposure": "deferred",
      "toolExposure": {
        "github_list_repos": "direct",
        "github_delete_*": "hidden"
      }
    }
  }
}
```

`toolExposure` keys are tool names or `*` patterns; values are `direct` (pin), `hidden` (suppress), `deferred` (tool_search discovery, the server default), or `codemode` (script-only). See pi's [tool exposure docs](https://pi.dev/docs/latest/mcp#control-tool-exposure).

## Commands

| Command | Description |
|---|---|
| `/aperture:onboarding` | Onboarding wizard. Only available while onboarding is enabled. |
| `/aperture:settings` | Edit connection, capabilities, and providers. |

## Configuration

Configuration is saved globally to `~/.pi/agent/extensions/aperture.json`. The settings UI covers everything, but you can also edit the file directly. The `APERTURE_BASE_URL` environment variable, when set, overrides the configured `baseUrl` (it is not written back to the config file):

```json
{
  "baseUrl": "http://ai.your-tailnet.ts.net",
  "proxy": {
    "enabled": true,
    "upstreamProviders": [
      { "id": "anthropic", "gatewayId": "anthropic-oauth", "shouldCheckGatewayModels": true }
    ]
  },
  "dedicated": {
    "enabled": true,
    "providers": [
      { "id": "anthropic", "name": "Anthropic", "enabled": true },
      { "id": "openrouter", "name": "OpenRouter", "enabled": true, "api": "anthropic-messages" },
      { "id": "google", "name": "Google", "enabled": false }
    ]
  },
  "mcp": {
    "enabled": false
  }
}
```

Notes:

- `proxy.upstreamProviders[].id` is the local Pi provider; `gatewayId` is the target gateway provider and is required. Existing configs gain `gatewayId: id` during migration. Unknown gateway targets are left unrouted with a warning. `aperture` is reserved and cannot be selected as a pairing target.
- Gateway providers that require client authentication forward the local provider's credential (including Pi OAuth); other providers use server-side credential injection.
- `keepGatewayModelsOnly` (per proxy provider, default `false`) hides that provider's local models the gateway doesn't serve instead of letting them fail at request time. Also editable per provider from the Proxy tab in `/aperture:settings`.
- `api` (per provider, unset by default) routes that provider's models through a specific Pi API (`openai-completions`, `anthropic-messages`, `openai-responses`, `google-generative-ai`, `google-vertex`, `bedrock-converse-stream`) instead of the one auto-picked from the gateway's compatibility map. Useful for providers Aperture serves through more than one API. Only values the provider reports as supported are offered in `/aperture:settings`; an override the gateway stops serving falls back to auto with a warning.
- An empty `dedicated.providers` list means all gateway providers are included. Passthrough providers are excluded: the dedicated provider never forwards a client credential.
- Model metadata belongs in `~/.pi/agent/models.json`, not in the extension config.
- Requests include `Referer` and `x-session-id` (the live Pi session id, injected per-request via the `before_provider_headers` hook) for grouping requests in the Aperture dashboard. Turn them off with `"shouldSendProvenanceHeaders": false` or the Provenance headers toggle in `/aperture:settings`. Independent of that setting, the headers are skipped whenever Pi telemetry is disabled (`PI_TELEMETRY=0` or `enableInstallTelemetry: false` in Pi settings) — the same gate Pi uses for its own provider attribution headers.
- No API keys are stored: Aperture injects upstream credentials server-side. Pi OAuth credentials still take precedence when available.

## Requirements

- A Tailscale tailnet with Aperture configured.
- The device running Pi must be able to reach your Aperture endpoint.
- Use the URL/scheme that matches your deployment (`http://` or `https://`).
