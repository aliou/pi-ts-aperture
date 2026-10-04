import type {
  ExtraSettingsTab,
  SectionedSettingItem,
  SettingsSection,
} from "@aliou/pi-utils-settings";
import type {
  ApertureConfig,
  ResolvedConfig,
} from "../../shared/config/loader";
import { boolLabel, GLOBAL_SCOPE, getTabConfig } from "./shared";

/**
 * Build the MCP extra tab.
 *
 * A single enable toggle plus an info row. Tool exposure is pi-native
 * (`/mcp`, `mcp.json` `toolExposure`), so the tab deliberately duplicates
 * none of it.
 */
export function buildMcpTab(): ExtraSettingsTab<
  ApertureConfig,
  ResolvedConfig
> {
  return {
    id: "mcp",
    label: "MCP",
    buildSections: (ctx): SettingsSection[] => {
      const draft = getTabConfig(ctx);
      const mcpEnabled = draft.mcp?.enabled ?? ctx.resolved.mcp.enabled;

      const items: SectionedSettingItem[] = [
        {
          id: "mcp.enabled",
          label: "MCP tools",
          description:
            "Register the gateway's /v1/mcp server with pi; tools surface as mcp__aperture__*",
          currentValue: boolLabel(mcpEnabled),
          values: ["enabled", "disabled"],
        },
        {
          id: "mcp.manage",
          label: "Manage MCP tools",
          description:
            "Tool exposure is pi-native: /mcp manages the server, toolExposure in mcp.json pins or hides tools",
          currentValue: "/mcp · mcp.json",
        },
      ];

      return [{ label: "MCP", items }];
    },
    onSettingChange: (id, newValue, tabCtx) => {
      tabCtx.applySettingChangeToScope(GLOBAL_SCOPE, id, newValue);
    },
  };
}
