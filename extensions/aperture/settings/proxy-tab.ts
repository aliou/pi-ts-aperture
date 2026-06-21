import {
  type ExtraSettingsTab,
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
  type SettingsSubmenuContext,
} from "@aliou/pi-utils-settings";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ApertureClient } from "../../../src/api/client";
import { mapProxyProviders } from "../../../src/provider-mapping";
import type {
  ApertureConfig,
  ResolvedConfig,
} from "../../../src/shared/config/loader";
import { AsyncEditor } from "./async-editor";
import { boolLabel, GLOBAL_SCOPE, getTabConfig } from "./shared";

/**
 * Build the Proxy extra tab.
 *
 * Hosts the proxy-enable toggle and the upstream-providers submenu, which
 * fetches Aperture gateway providers and lets the user toggle which Pi
 * providers get rerouted through Aperture (plus per-provider gateway model
 * checks).
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
              description: "Configured proxy providers and gateway checks",
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
                  loader: async () => {
                    const client = new ApertureClient(baseUrl);
                    const [providerInfos, gatewayProviders] = await Promise.all(
                      [client.providerConfigInfos(), client.providers()],
                    );
                    const providers = mapProxyProviders(
                      getKnownModels(),
                      providerInfos,
                      gatewayProviders,
                      upstreamProviders,
                    );
                    const enabled = new Set(
                      upstreamProviders.map((provider) => provider.id),
                    );
                    {
                      const updated = structuredClone(draft) as ApertureConfig;
                      updated.proxy = {
                        ...updated.proxy,
                        upstreamProviders: providers.filter((provider) =>
                          enabled.has(provider.id),
                        ),
                      };
                      setDraftForScope(GLOBAL_SCOPE, updated);
                    }
                    const fields: SettingsDetailField[] = providers.flatMap(
                      (p, i) => [
                        {
                          type: "boolean" as const,
                          id: `provider.${p.id}.enabled`,
                          label: p.name ?? p.id,
                          getValue: () => enabled.has(p.id),
                          setValue: (value: boolean) => {
                            if (value) enabled.add(p.id);
                            else enabled.delete(p.id);
                            const updated = structuredClone(
                              draft,
                            ) as ApertureConfig;
                            updated.proxy = {
                              ...updated.proxy,
                              upstreamProviders: providers.filter((provider) =>
                                enabled.has(provider.id),
                              ),
                            };
                            setDraftForScope(GLOBAL_SCOPE, updated);
                          },
                          trueLabel: "enabled",
                          falseLabel: "disabled",
                        },
                        {
                          type: "boolean" as const,
                          id: `provider.${p.id}.shouldCheckGatewayModels`,
                          label: `${p.name ?? p.id} — gateway model check`,
                          getValue: () => p.shouldCheckGatewayModels as boolean,
                          setValue: (value: boolean) => {
                            const provider = providers[i];
                            if (provider)
                              provider.shouldCheckGatewayModels = value;
                            const updated = structuredClone(
                              draft,
                            ) as ApertureConfig;
                            updated.proxy = {
                              ...updated.proxy,
                              upstreamProviders: providers.filter((provider) =>
                                enabled.has(provider.id),
                              ),
                            };
                            setDraftForScope(GLOBAL_SCOPE, updated);
                          },
                          trueLabel: "on",
                          falseLabel: "off",
                        },
                      ],
                    );
                    return new SettingsDetailEditor({
                      title: () =>
                        `Upstream Providers (${enabled.size}/${providers.length})`,
                      fields,
                      theme: settingsTheme,
                      requestRender: submenuCtx.requestRender,
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
                        "No local providers match the Aperture gateway provider base URLs.",
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
