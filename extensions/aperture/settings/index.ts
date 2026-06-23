import {
  registerSettingsCommand,
  type SettingsCommandOptions,
} from "@aliou/pi-utils-settings";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type {
  ApertureConfig,
  ResolvedConfig,
} from "../../../src/shared/config/loader";
import { configLoader } from "../../../src/shared/config/loader";
import { normalizeInputUrl } from "../../../src/url";
import { buildConnectorsTab } from "./connectors-tab";
import { buildDedicatedTab } from "./dedicated-tab";
import { buildGlobalSections } from "./global-tab";
import { buildProxyTab } from "./proxy-tab";

export const APERTURE_SETTINGS_COMMAND = "aperture:settings" as const;

/**
 * Register the `/aperture:settings` command.
 *
 * The settings UI is split into one Global scope tab (Connection + Setup)
 * plus one extra tab per capability (Proxy, Dedicated, Connectors), built
 * in `settings/<tab>-tab.ts` and assembled here into a single
 * {@link SettingsCommandOptions} handed to {@link registerSettingsCommand}.
 */
export function registerApertureSettings(
  pi: ExtensionAPI,
  onSync: (ctx: ExtensionContext) => void,
  getKnownModels: () => Model<Api>[],
): void {
  registerSettingsCommand<ApertureConfig, ResolvedConfig>(pi, {
    commandName: APERTURE_SETTINGS_COMMAND,
    title: "Aperture Settings",
    configStore: configLoader,

    buildSections: buildGlobalSections,

    extraTabs: [
      buildProxyTab(getKnownModels),
      buildDedicatedTab(),
      buildConnectorsTab(),
    ],

    onSettingChange: (id, newValue, config) => {
      const updated = structuredClone(config);
      if (id === "baseUrl") updated.baseUrl = normalizeInputUrl(newValue);
      if (id === "proxy.enabled")
        updated.proxy = { ...updated.proxy, enabled: newValue === "enabled" };
      if (id === "dedicated.enabled")
        updated.dedicated = {
          ...updated.dedicated,
          enabled: newValue === "enabled",
        };
      if (id === "connectors.enabled")
        updated.connectors = {
          ...updated.connectors,
          enabled: newValue === "enabled",
        };
      if (id === "connectors.discoveryTools")
        updated.connectors = {
          ...updated.connectors,
          discoveryTools: newValue === "enabled",
        };
      if (id === "onboardingDone") {
        updated.onboardingDone = newValue === "completed";
        updated.onboarding = {
          ...updated.onboarding,
          enabled: !updated.onboardingDone,
        };
      }
      if (id === "onboardingEnabled")
        updated.onboarding = {
          ...updated.onboarding,
          enabled: newValue === "enabled",
        };
      return updated;
    },
    onSave: (ctx) => onSync(ctx),
  });
}
