---
"@aliou/pi-ts-aperture": minor
---

Add connectors extension and restructure shared config.

- Connectors: new extension that discovers MCP tools from Aperture's `/v1/mcp` endpoint and registers them with Pi. Splits tools into pinned (first-class Pi tools) and proxied (reached through discovery meta-tools).
- Connectors config: `connectors.enabled` master switch (default `false`), `connectors.pinnedTools` stored as `{ connectorId; toolName }` objects, and `connectors.discoveryTools` toggle (default `true`) for the list / search / describe / call meta-tools.
- Resource proxy tools (`connector_resource_search` / `connector_resource_describe` / `connector_resource_serve`) for browsing gateway resources.
- Connector UI redesign with `@aliou/pi-utils-ui` components and Markdown rendering.
- Settings: new Connectors tab with pinned-tools submenu driven by `FilterableChecklist`, reading live gateway tool state.
- Config: extract shared config, types, and sync bus to `src/shared/`; add JSON Schema generation and `schema.json`; parse Aperture provider config as hujson so commented gateway configs work in settings.
- API: Typebox schemas with response validation, live integration tests, and API-verified connector IDs.
- Feature request/register event dispatching between aperture and connectors extensions.
