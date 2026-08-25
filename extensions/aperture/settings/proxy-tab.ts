import {
  type ExtraSettingsTab,
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
  type SettingsSubmenuContext,
} from "@aliou/pi-utils-settings";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ApertureClient } from "../../../src/api/client";
import type {
  ApertureConfig,
  ResolvedConfig,
} from "../../shared/config/loader";
import { mapProxyProviders } from "../../shared/provider-mapping";
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
 * Build the Proxy extra tab.
 *
 * Hosts the proxy-enable toggle and the upstream-providers submenu, which
 * fetches Aperture gateway providers and lets the user toggle which Pi
 * providers get rerouted through Aperture. The submenu lists one row per
 * provider with its enabled state; each row opens a per-provider submenu
 * holding the proxy toggle, the gateway options (model check, gateway models
 * only), and the API override.
 */
export function buildProxyTab(
  getKnownModels: () => Model<Api>[],
): ExtraSettingsTab<ApertureConfig, ResolvedConfig> {
  return {
    id: "proxy",
    label: "Proxy",
    buildSections: (ctx): SettingsSection[] => {
      const draft = getTabConfig(ctx);
      const { setDraftForScope, theme: settingsTheme } = ctx;
      const baseUrl = draft.baseUrl ?? ctx.resolved.baseUrl;
      const proxyEnabled = draft.proxy?.enabled ?? ctx.resolved.proxy.enabled;
      const upstreamProviders =
        draft.proxy?.upstreamProviders ?? ctx.resolved.proxy.upstreamProviders;

      return [
        {
          label: "Proxy",
          items: [
            {
              id: "proxy.enabled",
              label: "Proxy existing providers",
              description: "Route selected Pi providers through Aperture",
              currentValue: boolLabel(proxyEnabled),
              values: ["enabled", "disabled"],
            },
            {
              id: "proxy.upstreamProviders",
              label: "Upstream providers",
              description:
                "Choose which Pi providers get routed through Aperture, with per-provider gateway options",
              currentValue:
                upstreamProviders.length > 0
                  ? `${upstreamProviders.length} provider(s)`
                  : "none",
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
                    const client = new ApertureClient(baseUrl);
                    // /api/providers reflects grant-scoped enabled/disabled
                    // providers, so we match local Pi providers exclusively
                    // against it. No /aperture/config fetch is needed here.
                    const gatewayProviders = await client.providers(signal);
                    const compatibilityById = new Map(
                      gatewayProviders.map((gp) => [gp.id, gp.compatibility]),
                    );
                    const providers = mapProxyProviders(
                      getKnownModels(),
                      gatewayProviders,
                      upstreamProviders,
                    );
                    const enabled = new Set(
                      providers
                        .filter((provider) => provider.enabled)
                        .map((provider) => provider.id),
                    );
                    // Enabled rows are persisted; a disabled row is too, with
                    // enabled: false, when it was already configured or
                    // carries an api override — otherwise its settings would
                    // be silently dropped on save.
                    const persistProviders = () => {
                      const updated = structuredClone(draft) as ApertureConfig;
                      updated.proxy = {
                        ...updated.proxy,
                        upstreamProviders: providers
                          .filter(
                            (provider) =>
                              enabled.has(provider.id) ||
                              upstreamProviders.some(
                                (p) => p.id === provider.id,
                              ) ||
                              provider.api !== undefined,
                          )
                          .map((provider) => ({
                            id: provider.id,
                            name: provider.name,
                            ...(enabled.has(provider.id)
                              ? {}
                              : { enabled: false }),
                            shouldCheckGatewayModels:
                              provider.shouldCheckGatewayModels,
                            keepGatewayModelsOnly:
                              provider.keepGatewayModelsOnly,
                            api: provider.api,
                          })),
                      };
                      setDraftForScope(GLOBAL_SCOPE, updated);
                    };
                    persistProviders();
                    const fields: SettingsDetailField[] = providers.map((p) => {
                      const apiField = apiSelectionField({
                        id: `provider.${p.id}.api`,
                        compatibility: compatibilityById.get(p.id),
                        getValue: () => p.api,
                        setValue: (value) => {
                          p.api = value;
                          persistProviders();
                        },
                      });
                      return {
                        type: "submenu" as const,
                        id: `provider.${p.id}`,
                        label: p.name ?? p.id,
                        description: `Proxy toggle and gateway options for ${p.name ?? p.id}`,
                        getValue: () =>
                          providerSummary(enabled.has(p.id), p.api),
                        submenu: (providerDone, providerCtx) =>
                          new SettingsDetailEditor({
                            title: () =>
                              `${p.name ?? p.id} (${enabled.has(p.id) ? "enabled" : "disabled"})`,
                            fields: [
                              {
                                type: "boolean" as const,
                                id: `provider.${p.id}.enabled`,
                                label: "Proxy this provider",
                                description:
                                  "Route this provider's requests through the Aperture gateway",
                                getValue: () => enabled.has(p.id),
                                setValue: (value: boolean) => {
                                  if (value) enabled.add(p.id);
                                  else enabled.delete(p.id);
                                  persistProviders();
                                },
                                trueLabel: "enabled",
                                falseLabel: "disabled",
                              },
                              {
                                type: "boolean" as const,
                                id: `provider.${p.id}.shouldCheckGatewayModels`,
                                label: "Gateway model check",
                                description:
                                  "Warn when configured local models are missing from the gateway catalog",
                                getValue: () => p.shouldCheckGatewayModels,
                                setValue: (value: boolean) => {
                                  p.shouldCheckGatewayModels = value;
                                  persistProviders();
                                },
                                trueLabel: "on",
                                falseLabel: "off",
                              },
                              {
                                type: "boolean" as const,
                                id: `provider.${p.id}.keepGatewayModelsOnly`,
                                label: "Gateway models only",
                                description:
                                  "Register only the models the gateway serves instead of all locally known models",
                                getValue: () => p.keepGatewayModelsOnly,
                                setValue: (value: boolean) => {
                                  p.keepGatewayModelsOnly = value;
                                  persistProviders();
                                },
                                trueLabel: "on",
                                falseLabel: "off",
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
                    });
                    return new SettingsDetailEditor({
                      title: () =>
                        `Upstream Providers (${enabled.size}/${providers.length})`,
                      fields,
                      theme: settingsTheme,
                      requestRender: submenuCtx.requestRender,
                      hideHint: loaderCtx.hideHint,
                      contentHeight: SETTINGS_CONTENT_HEIGHT,
                      onDone: () =>
                        submenuDone(
                          providers.length > 0
                            ? `${enabled.size}/${providers.length} enabled`
                            : "none",
                        ),
                      getDoneSummary: () =>
                        providers.length > 0
                          ? `${enabled.size}/${providers.length} enabled`
                          : "none",
                      emptyStateText:
                        "No local providers match the Aperture gateway providers.",
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
