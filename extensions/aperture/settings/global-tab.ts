import {
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
  type SettingsSubmenuContext,
  type SettingsTheme,
} from "@aliou/pi-utils-settings";
import { normalizeInputUrl } from "../../../src/url";
import type {
  ApertureConfig,
  ResolvedConfig,
} from "../../shared/config/loader";
import { isProvenanceTelemetryAllowed } from "../../shared/provenance";
import { SETTINGS_CONTENT_HEIGHT } from "./shared";

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
  const shouldSendProvenanceHeaders =
    draft.shouldSendProvenanceHeaders ?? resolved.shouldSendProvenanceHeaders;

  const baseConnectionItem: SettingsSection = {
    label: "Connection",
    items: [
      {
        id: "baseUrl",
        label: "Base URL",
        description: "Aperture gateway URL on your tailnet",
        currentValue: baseUrl || "(not set)",
        submenu: (_val, submenuDone, submenuCtx: SettingsSubmenuContext) => {
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
            hideHint: submenuCtx.hideHint,
            contentHeight: SETTINGS_CONTENT_HEIGHT,
            onDone: (summary) =>
              submenuDone(summary ?? (currentUrl || "(not set)")),
            getDoneSummary: () => currentUrl || "(not set)",
          });
        },
      },
    ],
  };

  // pi-utils-settings has no `disabled` item flag; an item without
  // `values` (or a submenu) is read-only, so the telemetry-off case is
  // rendered as a plain display item.
  const telemetryAllowed = isProvenanceTelemetryAllowed();
  const provenanceItem: SettingsSection["items"][number] = telemetryAllowed
    ? {
        id: "shouldSendProvenanceHeaders",
        label: "Provenance headers",
        description: "Referer + session id on provider requests",
        currentValue: shouldSendProvenanceHeaders ? "enabled" : "disabled",
        values: ["enabled", "disabled"],
      }
    : {
        id: "shouldSendProvenanceHeaders",
        label: "Provenance headers",
        description:
          "Referer + session id on provider requests; forced off because pi telemetry is disabled (PI_TELEMETRY or enableInstallTelemetry).",
        currentValue: "disabled (pi telemetry off)",
      };

  const requestsItem: SettingsSection = {
    label: "Provider requests",
    items: [provenanceItem],
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

  return [baseConnectionItem, requestsItem, setupItem];
}
