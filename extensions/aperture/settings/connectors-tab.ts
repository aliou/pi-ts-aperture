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
 * Build the Connectors extra tab.
 *
 * A single enable toggle plus an info row. Tool exposure is pi-native
 * (`/mcp`, `mcp.json` `toolExposure`), so the tab deliberately duplicates
 * none of it.
 */
export function buildConnectorsTab(): ExtraSettingsTab<
  ApertureConfig,
  ResolvedConfig
> {
  return {
    id: "connectors",
    label: "Connectors",
    buildSections: (ctx): SettingsSection[] => {
      const draft = getTabConfig(ctx);
      const connectorsEnabled =
        draft.connectors?.enabled ?? ctx.resolved.connectors.enabled;

      const items: SectionedSettingItem[] = [
        {
          id: "connectors.enabled",
          label: "Connector tools",
          description:
            "Register the gateway's /v1/mcp server with pi; tools surface as mcp__aperture__*",
          currentValue: boolLabel(connectorsEnabled),
          values: ["enabled", "disabled"],
        },
        {
          id: "connectors.manage",
          label: "Manage connector tools",
          description:
            "Tool exposure is pi-native: /mcp manages the server, toolExposure in mcp.json pins or hides tools",
          currentValue: "/mcp · mcp.json",
        },
      ];

      return [{ label: "Connectors", items }];
    },
    onSettingChange: (id, newValue, tabCtx) => {
      tabCtx.applySettingChangeToScope(GLOBAL_SCOPE, id, newValue);
    },
  };
}
