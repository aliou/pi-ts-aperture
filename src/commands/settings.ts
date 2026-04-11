/**
 * aperture:settings -- settings UI for Aperture configuration.
 *
 * Sections:
 * - Connection: base URL, mode, gateway-model checking (override mode only)
 * - Providers: list of providers routed through Aperture (override mode only)
 */

import {
  ArrayEditor,
  registerSettingsCommand,
  type SettingsSection,
  setNestedValue,
} from "@aliou/pi-utils-settings";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import type { ApertureConfig, ApertureMode, ResolvedConfig } from "../config";
import { configLoader } from "../config";

const MODE_VALUES: ApertureMode[] = ["override", "provider"];

function describeMode(mode: ApertureMode): string {
  return mode === "provider"
    ? "provider (register 'aperture' with models from /v1/models)"
    : "override (route existing providers through the gateway)";
}

export function registerApertureSettings(
  pi: ExtensionAPI,
  onConfigChange: (ctx: ExtensionContext) => void,
): void {
  registerSettingsCommand<ApertureConfig, ResolvedConfig>(pi, {
    commandName: "aperture:settings",
    title: "Aperture Settings",
    configStore: configLoader,
    buildSections: (
      tabConfig: ApertureConfig | null,
      resolved: ResolvedConfig,
      { setDraft },
    ): SettingsSection[] => {
      const settingsTheme = getSettingsListTheme();

      const mode: ApertureMode = tabConfig?.mode ?? resolved.mode;
      const providers = tabConfig?.providers ?? resolved.providers;
      const checkGatewayModels: string[] =
        tabConfig?.checkGatewayModels ?? resolved.checkGatewayModels;

      const connectionItems: SettingsSection["items"] = [
        {
          id: "mode",
          label: "Mode",
          description:
            "override: route existing providers through the gateway. " +
            "provider: register 'aperture' as a new provider whose models come from /v1/models.",
          currentValue: describeMode(mode),
          values: MODE_VALUES,
          submenu: undefined,
        },
        {
          id: "baseUrl",
          label: "Base URL",
          description:
            "Aperture gateway URL on your tailnet (e.g. http://ai.pango-lin.ts.net)",
          currentValue: (tabConfig?.baseUrl ?? resolved.baseUrl) || "(not set)",
          values: undefined,
          submenu: undefined,
        },
      ];

      if (mode === "override") {
        connectionItems.push({
          id: "checkGatewayModels",
          label: "Gateway model checking",
          description:
            "Providers for which gateway model availability is checked",
          currentValue:
            checkGatewayModels.length > 0
              ? `${checkGatewayModels.length} provider(s)`
              : "disabled",
          values: undefined,
          submenu: (_val, submenuDone) => {
            let latest = [...checkGatewayModels];
            return new ArrayEditor({
              label: "Gateway-checked providers",
              items: [...checkGatewayModels],
              theme: settingsTheme,
              onSave: (items) => {
                latest = items;
                const updated = structuredClone(
                  tabConfig ?? {},
                ) as ApertureConfig;
                setNestedValue(updated, "checkGatewayModels", items);
                setDraft(updated);
              },
              onDone: () =>
                submenuDone(
                  latest.length > 0
                    ? `${latest.length} provider(s)`
                    : "disabled",
                ),
            });
          },
        });
      }

      const sections: SettingsSection[] = [
        { label: "Connection", items: connectionItems },
      ];

      if (mode === "override") {
        sections.push({
          label: "Providers",
          items: [
            {
              id: "providers",
              label: "Routed providers",
              description: "LLM providers routed through Aperture",
              currentValue: `${providers.length} provider(s)`,
              submenu: (_val, submenuDone) => {
                let latest = [...providers];
                return new ArrayEditor({
                  label: "Providers",
                  items: [...providers],
                  theme: settingsTheme,
                  onSave: (items) => {
                    latest = items;
                    const updated = structuredClone(
                      tabConfig ?? {},
                    ) as ApertureConfig;
                    setNestedValue(updated, "providers", items);
                    setDraft(updated);
                  },
                  onDone: () => submenuDone(`${latest.length} provider(s)`),
                });
              },
            },
          ],
        });
      }

      return sections;
    },
    onSettingChange: (id, newValue, config) => {
      const updated = structuredClone(config);
      if (id === "baseUrl") {
        updated.baseUrl = newValue;
      } else if (id === "mode") {
        updated.mode = newValue as ApertureMode;
      } else {
        setNestedValue(updated, id, newValue);
      }
      return updated;
    },
    onSave: (ctx) => {
      onConfigChange(ctx);
    },
  });
}
