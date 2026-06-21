import {
  type ExtraSettingsTab,
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
  type SettingsSubmenuContext,
} from "@aliou/pi-utils-settings";
import { ApertureClient } from "../../../src/api/client";
import { mapDedicatedProviders } from "../../../src/provider-mapping";
import type {
  ApertureConfig,
  DedicatedProviderConfig,
  ResolvedConfig,
} from "../../../src/shared/config/loader";
import { AsyncEditor } from "./async-editor";
import { boolLabel, GLOBAL_SCOPE, getTabConfig } from "./shared";

/**
 * Build the Dedicated extra tab.
 *
 * Hosts the dedicated-enable toggle and the providers submenu, which
 * filters which Aperture gateway providers contribute models to the
 * standalone `aperture` provider.
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
                "Gateway providers included in the aperture provider",
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
                  loader: async () => {
                    const gatewayProviders = await new ApertureClient(
                      baseUrl,
                    ).providers();
                    const providers: DedicatedProviderConfig[] =
                      mapDedicatedProviders(
                        gatewayProviders,
                        dedicatedProviders,
                      );
                    {
                      const updated = structuredClone(draft) as ApertureConfig;
                      updated.dedicated = {
                        ...updated.dedicated,
                        providers,
                      };
                      setDraftForScope(GLOBAL_SCOPE, updated);
                    }
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
                            draft,
                          ) as ApertureConfig;
                          updated.dedicated = {
                            ...updated.dedicated,
                            providers,
                          };
                          setDraftForScope(GLOBAL_SCOPE, updated);
                        },
                        trueLabel: "enabled",
                        falseLabel: "disabled",
                      }),
                    );
                    return new SettingsDetailEditor({
                      title: () =>
                        `Dedicated Providers (${providers.filter((p) => p.enabled).length}/${providers.length})`,
                      fields,
                      theme: settingsTheme,
                      requestRender: submenuCtx.requestRender,
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
