/**
 * aperture:settings -- settings UI for Aperture configuration.
 *
 * Sections:
 * - Connection: base URL (editable)
 * - Mode: dedicated or proxy
 * - Proxy: upstream providers list with gateway check sub-options
 * - Dedicated: (empty for now)
 * - Setup: onboarding status and re-enable action
 */

import {
  registerSettingsCommand,
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
} from "@aliou/pi-utils-settings";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type {
  ApertureConfig,
  ApertureMode,
  DedicatedProviderConfig,
  ResolvedConfig,
} from "../../lib/config";
import { configLoader } from "../../lib/config";
import { normalizeInputUrl } from "../../lib/url";

const MODE_LABELS: Record<ApertureMode, string> = {
  dedicated: "Dedicated Aperture provider",
  proxy: "Proxy existing providers",
};

function getModeFromLabel(label: string): ApertureMode {
  if (label === MODE_LABELS.dedicated) return "dedicated";
  return "proxy";
}

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
      const baseUrl = tabConfig?.baseUrl ?? resolved.baseUrl;
      const mode = tabConfig?.mode ?? resolved.mode;
      const onboardingDone =
        tabConfig?.onboardingDone ?? resolved.onboardingDone;
      const onboardingEnabled =
        tabConfig?.onboarding?.enabled ?? resolved.onboarding.enabled;
      const upstreamProviders =
        tabConfig?.proxy?.upstreamProviders ?? resolved.proxy.upstreamProviders;
      const dedicatedProviders =
        tabConfig?.dedicated?.providers ?? resolved.dedicated.providers;

      return [
        {
          label: "Connection",
          items: [
            {
              id: "baseUrl",
              label: "Base URL",
              description:
                "Aperture gateway URL on your tailnet (e.g. http://ai.pango-lin.ts.net)",
              currentValue: baseUrl || "(not set)",
              submenu: (
                _val: string,
                submenuDone: (selectedValue?: string) => void,
              ) => {
                let currentUrl = baseUrl;

                const fields: SettingsDetailField[] = [
                  {
                    type: "text",
                    id: "baseUrl",
                    label: "Base URL",
                    getValue: () => currentUrl,
                    setValue: (value) => {
                      currentUrl = value;
                      const updated = structuredClone(
                        tabConfig ?? {},
                      ) as ApertureConfig;
                      updated.baseUrl = normalizeInputUrl(value);
                      setDraft(updated);
                    },
                    validate: (value) => {
                      if (!value.trim()) return "URL cannot be empty";
                      return null;
                    },
                    displayValue: (value) => value || "(not set)",
                    emptyValueText: "(not set)",
                  },
                ];

                return new SettingsDetailEditor({
                  title: "Base URL",
                  fields,
                  theme: getSettingsListTheme(),
                  onDone: (summary) =>
                    submenuDone(summary ?? (baseUrl || "(not set)")),
                  getDoneSummary: () => currentUrl || "(not set)",
                });
              },
            },
          ],
        },
        {
          label: "Mode",
          items: [
            {
              id: "mode",
              label: "Mode",
              description:
                mode === "dedicated"
                  ? "A standalone aperture provider with models from the gateway"
                  : "Existing Pi providers rerouted through Aperture",
              currentValue: MODE_LABELS[mode],
              values: [MODE_LABELS.dedicated, MODE_LABELS.proxy],
            },
          ],
        },
        {
          label: "Proxy",
          items: [
            {
              id: "proxy.upstreamProviders",
              label: "Upstream providers",
              description:
                mode === "proxy"
                  ? "Providers routed through Aperture in proxy mode"
                  : "Not applicable in dedicated mode",
              currentValue:
                mode === "proxy"
                  ? upstreamProviders.length > 0
                    ? `${upstreamProviders.length} provider(s)`
                    : "none"
                  : "n/a",
              submenu:
                mode === "proxy"
                  ? (
                      _val: string,
                      submenuDone: (selectedValue?: string) => void,
                    ) => {
                      const theme = getSettingsListTheme();
                      const providers = structuredClone(upstreamProviders);

                      const fields: SettingsDetailField[] = providers.map(
                        (p, i) => ({
                          type: "boolean" as const,
                          id: `provider.${p.id}.shouldCheckGatewayModels`,
                          label: `${p.id} \u2014 verify gateway models`,
                          getValue: () => p.shouldCheckGatewayModels as boolean,
                          setValue: (value: boolean) => {
                            const provider = providers[i];
                            if (provider)
                              provider.shouldCheckGatewayModels = value;
                            const updated = structuredClone(
                              tabConfig ?? {},
                            ) as ApertureConfig;
                            updated.proxy = { upstreamProviders: providers };
                            setDraft(updated);
                          },
                          trueLabel: "on",
                          falseLabel: "off",
                        }),
                      );

                      return new SettingsDetailEditor({
                        title: () => `Upstream Providers (${providers.length})`,
                        fields,
                        theme,
                        onDone: () =>
                          submenuDone(
                            providers.length > 0
                              ? `${providers.length} provider(s)`
                              : "none",
                          ),
                        getDoneSummary: () =>
                          providers.length > 0
                            ? `${providers.length} provider(s)`
                            : "none",
                        emptyStateText: "No proxy providers configured",
                      });
                    }
                  : undefined,
            },
          ],
        },
        {
          label: "Dedicated",
          items: [
            {
              id: "dedicated.providers",
              label: "Aperture providers",
              description:
                mode === "dedicated"
                  ? "Gateway providers included in the aperture provider"
                  : "Not applicable in proxy mode",
              currentValue:
                mode === "dedicated"
                  ? (() => {
                      const enabled = dedicatedProviders.filter(
                        (p) => p.enabled,
                      );
                      return enabled.length > 0
                        ? `${enabled.length}/${dedicatedProviders.length} enabled`
                        : dedicatedProviders.length > 0
                          ? "none enabled"
                          : "all (no filter)";
                    })()
                  : "n/a",
              submenu:
                mode === "dedicated"
                  ? (
                      _val: string,
                      submenuDone: (selectedValue?: string) => void,
                    ) => {
                      const theme = getSettingsListTheme();
                      const providers = structuredClone(dedicatedProviders);

                      const fields: SettingsDetailField[] = providers.map(
                        (p: DedicatedProviderConfig, i: number) => ({
                          type: "boolean" as const,
                          id: `dedicated.provider.${p.id}.enabled`,
                          label: p.name ?? p.id,
                          getValue: () => p.enabled,
                          setValue: (value: boolean) => {
                            const provider = providers[i];
                            if (provider) provider.enabled = value;
                            const updated = structuredClone(
                              tabConfig ?? {},
                            ) as ApertureConfig;
                            updated.dedicated = { providers };
                            setDraft(updated);
                          },
                          trueLabel: "enabled",
                          falseLabel: "disabled",
                        }),
                      );

                      return new SettingsDetailEditor({
                        title: () =>
                          `Dedicated Providers (${providers.filter((p) => p.enabled).length}/${providers.length})`,
                        fields,
                        theme,
                        onDone: () => {
                          const enabled = providers.filter((p) => p.enabled);
                          submenuDone(
                            enabled.length > 0
                              ? `${enabled.length}/${providers.length} enabled`
                              : "none enabled",
                          );
                        },
                        getDoneSummary: () => {
                          const enabled = providers.filter((p) => p.enabled);
                          return enabled.length > 0
                            ? `${enabled.length}/${providers.length} enabled`
                            : "none enabled";
                        },
                        emptyStateText:
                          "No providers configured. Run /aperture:onboarding to discover providers.",
                      });
                    }
                  : undefined,
            },
          ],
        },
        {
          label: "Setup",
          items: [
            {
              id: "onboardingDone",
              label: "Onboarding",
              description: onboardingDone
                ? "Setup has been completed. Set to pending to re-run /aperture:onboarding on next reload."
                : "Setup is pending. Run /aperture:onboarding to configure Aperture.",
              currentValue: onboardingDone ? "completed" : "pending",
              values: ["completed", "pending"],
            },
            {
              id: "onboardingEnabled",
              label: "Onboarding extension",
              description:
                "Controls temporary onboarding tools and the sync-aperture-models skill.",
              currentValue: onboardingEnabled ? "enabled" : "disabled",
              values: ["enabled", "disabled"],
            },
          ],
        },
      ];
    },
    onSettingChange: (id, newValue, config) => {
      const updated = structuredClone(config);
      if (id === "mode") {
        updated.mode = getModeFromLabel(newValue);
      } else if (id === "baseUrl") {
        updated.baseUrl = newValue;
      } else if (id === "onboardingDone") {
        updated.onboardingDone = newValue === "completed";
        updated.onboarding = {
          ...updated.onboarding,
          enabled: !updated.onboardingDone,
        };
      } else if (id === "onboardingEnabled") {
        updated.onboarding = {
          ...updated.onboarding,
          enabled: newValue === "enabled",
        };
      }
      return updated;
    },
    onSave: (ctx) => {
      const config = configLoader.getConfig();
      if (config.mode === "proxy") {
        onSync(ctx);
      } else if (config.mode === "dedicated") {
        ctx.ui.notify(
          "[aperture] reloading in 2s to apply dedicated mode changes...",
          "info",
        );
        setTimeout(() => {
          ctx.ui.notify("[aperture] reloading in 1s...", "info");
          setTimeout(() => void ctx.reload(), 1000);
        }, 1000);
      }
    },
  });
}
