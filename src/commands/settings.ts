/**
 * aperture:settings -- settings UI for Aperture configuration.
 *
 * Sections:
 * - Connection: base URL
 * - Providers: list of providers routed through Aperture
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
import type { ApertureConfig, ResolvedConfig } from "../lib/config";
import { configLoader } from "../lib/config";

export function registerApertureSettings(
  pi: ExtensionAPI,
  onSync: (ctx: ExtensionContext) => void,
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

      const providers = tabConfig?.providers ?? resolved.providers;

      const checkGatewayModels: string[] =
        tabConfig?.checkGatewayModels ?? resolved.checkGatewayModels;

      return [
        {
          label: "Connection",
          items: [
            {
              id: "baseUrl",
              label: "Base URL",
              description:
                "Aperture gateway URL on your tailnet (e.g. http://ai.pango-lin.ts.net)",
              currentValue:
                (tabConfig?.baseUrl ?? resolved.baseUrl) || "(not set)",
              values: undefined,
              submenu: undefined,
            },
            {
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
            },
          ],
        },
        {
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
        },
      ];
    },
    onSettingChange: (id, newValue, config) => {
      const updated = structuredClone(config);
      if (id === "baseUrl") {
        updated.baseUrl = newValue;
      } else {
        setNestedValue(updated, id, newValue);
      }
      return updated;
    },
    onSave: (ctx) => {
      onSync(ctx);
    },
  });
}
