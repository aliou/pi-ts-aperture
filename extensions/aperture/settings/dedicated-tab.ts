import {
  type ExtraSettingsTab,
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
  type SettingsSubmenuContext,
} from "@aliou/pi-utils-settings";
import { ApertureClient } from "../../../src/api/client";
import type {
  ApertureConfig,
  DedicatedProviderConfig,
  ResolvedConfig,
} from "../../shared/config/loader";
import { mapDedicatedProviders } from "../../shared/provider-mapping";
import { AsyncEditor } from "./async-editor";
import {
  apiSelectionField,
  boolLabel,
  GLOBAL_SCOPE,
  getTabConfig,
  providerSummary,
  SETTINGS_CONTENT_HEIGHT,
} from "./shared";

/**
 * Build the Dedicated extra tab.
 *
 * Hosts the dedicated-enable toggle and the providers submenu, which
 * filters which Aperture gateway providers contribute models to the
 * standalone `aperture` provider. The submenu lists one row per provider
 * with its enabled state; each row opens a per-provider submenu holding the
 * include toggle and the API override.
 */
export function buildDedicatedTab(): ExtraSettingsTab<
  ApertureConfig,
  ResolvedConfig
> {
  return {
    id: "dedicated",
    label: "Dedicated",
    buildSections: (ctx): SettingsSection[] => {
      const draft = getTabConfig(ctx);
      const { setDraftForScope, theme: settingsTheme } = ctx;
      const baseUrl = draft.baseUrl ?? ctx.resolved.baseUrl;
      const dedicatedEnabled =
        draft.dedicated?.enabled ?? ctx.resolved.dedicated.enabled;
      const dedicatedProviders =
        draft.dedicated?.providers ?? ctx.resolved.dedicated.providers;

      return [
        {
          label: "Dedicated",
          items: [
            {
              id: "dedicated.enabled",
              label: "Dedicated Aperture provider",
              description: "Register a standalone aperture provider",
              currentValue: boolLabel(dedicatedEnabled),
              values: ["enabled", "disabled"],
            },
            {
              id: "dedicated.providers",
              label: "Aperture providers",
              description:
                "Choose which gateway providers contribute to the aperture provider, with per-provider routing options",
              currentValue:
                dedicatedProviders.length > 0
                  ? `${dedicatedProviders.filter((p) => p.enabled).length}/${dedicatedProviders.length} enabled`
                  : "all (no filter)",
              submenu: (
                _val,
                submenuDone,
                submenuCtx: SettingsSubmenuContext,
              ) =>
                new AsyncEditor({
                  requestRender: submenuCtx.requestRender,
                  onCancel: () => submenuDone(undefined),
                  loadingDescription: "Fetching gateway providers",
                  hideHint: submenuCtx.hideHint,
                  loader: async (signal, loaderCtx) => {
                    const gatewayProviders = await new ApertureClient(
                      baseUrl,
                    ).providers(signal);
                    const compatibilityById = new Map(
                      gatewayProviders.map((gp) => [gp.id, gp.compatibility]),
                    );
                    const providers: DedicatedProviderConfig[] =
                      mapDedicatedProviders(
                        gatewayProviders,
                        dedicatedProviders,
                      );
                    const persistProviders = () => {
                      const updated = structuredClone(draft) as ApertureConfig;
                      updated.dedicated = {
                        ...updated.dedicated,
                        providers,
                      };
                      setDraftForScope(GLOBAL_SCOPE, updated);
                    };
                    persistProviders();
                    const fields: SettingsDetailField[] = providers.map(
                      (p: DedicatedProviderConfig) => {
                        const apiField = apiSelectionField({
                          id: `dedicated.provider.${p.id}.api`,
                          compatibility: compatibilityById.get(p.id),
                          getValue: () => p.api,
                          setValue: (value) => {
                            p.api = value;
                            persistProviders();
                          },
                        });
                        return {
                          type: "submenu" as const,
                          id: `dedicated.provider.${p.id}`,
                          label: p.name ?? p.id,
                          description: `Dedicated toggle and routing for ${p.name ?? p.id}`,
                          getValue: () => providerSummary(p.enabled, p.api),
                          submenu: (providerDone, providerCtx) =>
                            new SettingsDetailEditor({
                              title: () =>
                                `${p.name ?? p.id} (${p.enabled ? "enabled" : "disabled"})`,
                              fields: [
                                {
                                  type: "boolean" as const,
                                  id: `dedicated.provider.${p.id}.enabled`,
                                  label: "Include provider",
                                  description:
                                    "Include this provider's models in the aperture provider",
                                  getValue: () => p.enabled,
                                  setValue: (value: boolean) => {
                                    p.enabled = value;
                                    persistProviders();
                                  },
                                  trueLabel: "enabled",
                                  falseLabel: "disabled",
                                },
                                ...(apiField ? [apiField] : []),
                              ],
                              theme: settingsTheme,
                              requestRender: providerCtx.requestRender,
                              hideHint: providerCtx.hideHint,
                              contentHeight: SETTINGS_CONTENT_HEIGHT,
                              onDone: () => providerDone(),
                            }),
                        };
                      },
                    );
                    return new SettingsDetailEditor({
                      title: () =>
                        `Dedicated Providers (${providers.filter((p) => p.enabled).length}/${providers.length})`,
                      fields,
                      theme: settingsTheme,
                      requestRender: submenuCtx.requestRender,
                      hideHint: loaderCtx.hideHint,
                      contentHeight: SETTINGS_CONTENT_HEIGHT,
                      onDone: () =>
                        submenuDone(
                          providers.length > 0
                            ? `${providers.filter((p) => p.enabled).length}/${providers.length} enabled`
                            : "none",
                        ),
                      getDoneSummary: () =>
                        providers.length > 0
                          ? `${providers.filter((p) => p.enabled).length}/${providers.length} enabled`
                          : "none",
                      emptyStateText:
                        "No providers found on the Aperture gateway.",
                    });
                  },
                }),
            },
          ],
        },
      ];
    },
    onSettingChange: (id, newValue, ctx) => {
      ctx.applySettingChangeToScope(GLOBAL_SCOPE, id, newValue);
    },
  };
}
