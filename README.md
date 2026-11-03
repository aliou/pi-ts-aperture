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

The wizard asks for your Aperture URL (with a health check), lets you pick capabilities, providers, and whether to register the gateway's MCP tools (off by default), then saves and reloads Pi. You can change everything later with `/aperture:settings`.

## Capabilities

### Dedicated provider (default)

[![Dedicated provider walkthrough](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/dedicated-provider.gif)](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/dedicated-provider.mp4)

Registers a standalone `aperture` provider listing the models your gateway exposes. Include all gateway providers or filter to specific ones, and each model is routed through the Pi API that matches its Aperture compatibility.

Capabilities (vision input, reasoning, thinking levels) come from the first source that knows the model: `~/.pi/agent/models.json`, then Pi's model registry, then [models.dev](https://models.dev), then safe defaults. Costs, the context window, and the output limit come from the gateway where it reports them, because they describe the route Pi calls and a reseller can cap a model below its native capacity. The resolved catalog is cached in Pi's models store, so models load instantly on startup, even offline.

### Proxy existing providers

[![Proxy providers walkthrough](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/proxy-providers.gif)](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/proxy-providers.mp4)

Reroutes existing Pi providers through Aperture. Each provider keeps its own model definitions and settings, and sessions resume on the same model. Aperture injects server-side credentials, or forwards Pi's own credential for passthrough providers. OpenAI Responses passthrough routes support Pi's **Sign in with ChatGPT**.

Pick providers in the Proxy tab of `/aperture:settings`. A local provider can target a different gateway id (for example, `anthropic` → `anthropic-oauth`), and several local providers can share one gateway target. Optional per-provider verification warns when local models are missing from the gateway; `keepGatewayModelsOnly: true` hides them from the model picker instead.

### MCP tools

[![MCP walkthrough](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/connectors.gif)](https://assets.aliou.me/pi-extensions/demos/aperture/v0.8.0/connectors.mp4)

Aperture can expose MCP tools (GitHub, your own internal tools, ...) at `/v1/mcp`. When enabled, this extension registers that endpoint with Pi's built-in MCP support as the `aperture` server with `deferred` exposure: tools surface as `mcp__aperture__*` and stay out of the system prompt until Pi's `tool_search` loads them.

Enable MCP tools in `/aperture:settings`; the change applies immediately, no reload needed. Manage the connection with `/mcp`. To pin tools (always declared to the model) or hide them, add a same-name entry to `~/.pi/agent/mcp.json` — a file entry takes precedence over the extension's registration:

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
| `/aperture:proxy` | Shortcut for `/aperture:settings` on the Proxy tab. |
| `/aperture:dedicated` | Shortcut for `/aperture:settings` on the Dedicated tab. |
| `/aperture:mcp` | Shortcut for `/aperture:settings` on the MCP tab. |

## Configuration

Configuration is saved globally to `~/.pi/agent/extensions/aperture.json`. The settings UI covers everything, but you can also edit the file directly. The `APERTURE_BASE_URL` environment variable, when set, overrides the configured `baseUrl` (it is not written back to the config file):

```json
{
  "baseUrl": "http://ai.pango-lin.ts.net",
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
- `keepGatewayModelsOnly` (per proxy provider, default `false`) hides that provider's local models the gateway doesn't serve instead of letting them fail at request time.
- `api` (per provider, unset by default) forces a specific Pi API (`openai-completions`, `anthropic-messages`, `openai-responses`, `google-generative-ai`, `google-vertex`, `bedrock-converse-stream`) instead of the one picked from the gateway's compatibility map. Use it for providers Aperture serves through more than one API. If the gateway stops serving the override, the provider falls back to auto with a warning.
- An empty `dedicated.providers` list means all gateway providers are included. Passthrough providers are excluded: the dedicated provider never forwards a client credential.
- Models the gateway serves only over the System One endpoint (`/v1/systemone`) appear on the `aperture` provider as classifiers, callable via `models.classify`, not as chat models. Configure them per model with `model_compatibility` in the Aperture config.
- Model metadata belongs in `~/.pi/agent/models.json`, not in the extension config.
- Requests include `Referer` and `x-session-id` (the current Pi session) so the Aperture dashboard can group them. Turn them off with `"shouldSendProvenanceHeaders": false` or the Provenance headers toggle. They are also skipped whenever Pi telemetry is disabled (`PI_TELEMETRY=0` or `enableInstallTelemetry: false`).
- No API keys are stored: Aperture injects upstream credentials server-side. Pi OAuth credentials still take precedence when available.

## Library use

The package also ships a standalone provider for use outside Pi, without the coding agent or any config file. It builds the same `aperture` provider the extension registers: the model catalog is fetched from the gateway, each model is routed through the pi-ai API matching its Aperture compatibility, and the gateway injects credentials server-side (the provider's own API key is a placeholder).

```bash
pnpm add @aliou/pi-ts-aperture @earendil-works/pi-ai
```

```ts
import { createModels } from "@earendil-works/pi-ai/models";
import createApertureProvider from "@aliou/pi-ts-aperture/provider";

const models = createModels();
models.setProvider(
  createApertureProvider({
    baseUrl: "https://ai.<tailnet>.ts.net",
    provenance: { referer: "https://yourapp.example" },
  }),
);
await models.refresh();
```

The gateway `baseUrl` is required and must be set. Provenance headers (`Referer` plus a per-request `x-session-id`) are on by default; pass `provenance: { enabled: false }` to drop them. Refreshes are driven by pi-ai's `Models.refresh()` (or a direct `provider.refreshModels(context)` with a `ModelsStore`), so the catalog persists and restores through the host's store.

Pass `registryModels` to merge a host-side model catalog: gateway models inherit metadata (name, reasoning, vision input, thinking levels, context window, `compat`) and native upstream base URLs from matching entries, the same way the extension merges Pi's registry. Without it, metadata comes from models.dev and safe defaults. Pass `providers` to include only selected gateway providers and to set per-provider api overrides; leave it out to route every callable provider with automatic api selection.

## Requirements

- A Tailscale tailnet with Aperture configured.
- The device running Pi must be able to reach your Aperture endpoint.
- Use the URL/scheme that matches your deployment (`http://` or `https://`).
