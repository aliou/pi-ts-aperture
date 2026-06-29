---
"@aliou/pi-ts-aperture": minor
---

Rename connector discovery meta-tools with an `aperture_` prefix and remove the resource proxy tools.

- The four discovery meta-tools are now `aperture_connector_list`,
  `aperture_connector_tool_search`, `aperture_connector_tool_describe`,
  and `aperture_connector_tool_call`. The prefix avoids collisions with
  other extensions and signals the Aperture provenance.
- Removed `connector_resource_search`, `connector_resource_describe`, and
  `connector_resource_serve`. Pi does not support MCP resources well enough
  yet, so the resource browsing flow is gone until that lands. The MCP
  session still exposes the resource methods; only the Pi tool wrappers
  were removed.
