---
"@aliou/pi-ts-aperture": minor
---

Replace the connectors extension's custom MCP client and the four `aperture_connector_*` discovery meta-tools with pi's built-in MCP support. The gateway's `/v1/mcp` endpoint is now registered via `pi.registerMcpServer("aperture", { exposure: "deferred" })`, so connector tools surface as pi-native `mcp__aperture__*` tools discovered through pi's `tool_search` and managed with `/mcp`.

Requires pi 1.0 or newer (the peer range now reads `>=1.0.0`), which is where `pi.registerMcpServer` ships.

`connectors.pinnedTools` and `connectors.discoveryTools` are gone; `connectors` shrinks to `{ enabled }`. Migration `005-native-mcp-connectors` (config version 0.17.0) removes both keys from existing configs automatically. The pi-native replacements: pin or hide tools with `toolExposure` on an `aperture` entry in `mcp.json` (`"direct"` pins, `"hidden"` suppresses; a same-name `mcp.json` entry takes precedence over the extension's session-scoped registration), and discovery keeps the old `discoveryTools: true` behavior via the server's `deferred` exposure.
