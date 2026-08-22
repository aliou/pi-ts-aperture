import {
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
  type SettingsTheme,
} from "@aliou/pi-utils-settings";
import { normalizeInputUrl } from "../../../src/url";
import type {
  ApertureConfig,
  ResolvedConfig,
} from "../../shared/config/loader";

interface GlobalTabContext {
  setDraft: (config: ApertureConfig) => void;
  theme: SettingsTheme;
}

/**
 * Build the Global scope tab sections (Connection + Setup).
 *
 * Hosts settings that don't belong to a specific capability. Capability
 * toggles + their submenus live in extra tabs.
 */
export function buildGlobalSections(
  tabConfig: ApertureConfig | null,
  resolved: ResolvedConfig,
  ctx: GlobalTabContext,
): SettingsSection[] {
  const draft = tabConfig ?? {};
  const baseUrl = draft.baseUrl ?? resolved.baseUrl;
  const onboardingDone = draft.onboardingDone ?? resolved.onboardingDone;
  const onboardingEnabled =
    draft.onboarding?.enabled ?? resolved.onboarding.enabled;

  const baseConnectionItem: SettingsSection = {
    label: "Connection",
    items: [
      {
        id: "baseUrl",
        label: "Base URL",
        description: "Aperture gateway URL on your tailnet",
        currentValue: baseUrl || "(not set)",
        submenu: (_val, submenuDone) => {
          let currentUrl = baseUrl;
          const fields: SettingsDetailField[] = [
            {
              type: "text",
              id: "baseUrl",
              label: "Base URL",
              getValue: () => currentUrl,
              setValue: (value) => {
                currentUrl = value;
                const updated = structuredClone(draft) as ApertureConfig;
                updated.baseUrl = normalizeInputUrl(value);
                ctx.setDraft(updated);
              },
              validate: (value) =>
                value.trim() ? null : "URL cannot be empty",
              displayValue: (value) => value || "(not set)",
              emptyValueText: "(not set)",
            },
          ];
          return new SettingsDetailEditor({
            title: "Base URL",
            fields,
            theme: ctx.theme,
            onDone: (summary) =>
              submenuDone(summary ?? (currentUrl || "(not set)")),
            getDoneSummary: () => currentUrl || "(not set)",
          });
        },
      },
    ],
  };

  const setupItem: SettingsSection = {
    label: "Setup",
    items: [
      {
        id: "onboardingDone",
        label: "Onboarding",
        description: onboardingDone ? "Setup completed" : "Setup pending",
        currentValue: onboardingDone ? "completed" : "pending",
        values: ["completed", "pending"],
      },
      {
        id: "onboardingEnabled",
        label: "Onboarding extension",
        description: "Controls first-run onboarding command",
        currentValue: onboardingEnabled ? "enabled" : "disabled",
        values: ["enabled", "disabled"],
      },
    ],
  };

  return [baseConnectionItem, setupItem];
}
