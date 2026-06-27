import type {
  ExtraSettingsTab,
  SettingsSection,
  SettingsSubmenuContext,
} from "@aliou/pi-utils-settings";
import type { Api, Model } from "@earendil-works/pi-ai";
import { ApertureClient } from "../../../src/api/client";
import type {
  ApertureConfig,
  ProxiedProviderConfig,
  ResolvedConfig,
} from "../../../src/shared/config/loader";
import { AsyncEditor } from "./async-editor";
import {
  buildProxyRows,
  ProxyUpstreamProvidersEditor,
} from "./proxy-upstream-editor";
import { boolLabel, GLOBAL_SCOPE, getTabConfig } from "./shared";

/**
 * Build the Proxy extra tab.
 *
 * Hosts the proxy-enable toggle and the upstream-providers submenu. The
 * submenu lists EVERY local Pi provider (not just auto-matched ones) and lets
 * the user map any of them — including `anthropic` / `openai-codex` when they
 * did not auto-match — to any Aperture gateway provider, or re-point an
 * already-mapped provider to a different gateway endpoint. This is the escape
 * hatch for non-admin grants that get 403 on the admin-only `/aperture/config`
 * and so cannot use automatic base-URL matching.
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
              description: "Proxied Pi providers and gateway model checks",
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
                  loader: async (signal) => {
                    const client = new ApertureClient(baseUrl);
                    const [providerInfos, gatewayProviders] = await Promise.all(
                      [
                        client.providerConfigInfos(signal),
                        client.providers(signal),
                      ],
                    );
                    const knownModels = getKnownModels();
                    const { entries, autoMatchUnavailable } = buildProxyRows(
                      knownModels,
                      gatewayProviders,
                      providerInfos,
                      upstreamProviders,
                      // providerConfigInfos() returns an empty map on the 403
                      // non-admin grants get from the admin-only
                      // /aperture/config; surface that so the submenu can point
                      // users to manual mapping instead of an opaque empty list.
                      providerInfos.size === 0,
                    );

                    const persist = (next: ProxiedProviderConfig[]) => {
                      const updated = structuredClone(draft) as ApertureConfig;
                      updated.proxy = {
                        ...updated.proxy,
                        upstreamProviders: next,
                      };
                      setDraftForScope(GLOBAL_SCOPE, updated);
                    };

                    return new ProxyUpstreamProvidersEditor({
                      theme: settingsTheme,
                      requestRender: submenuCtx.requestRender,
                      onDone: (summary) => submenuDone(summary ?? "back"),
                      gatewayProviders,
                      entries,
                      persist,
                      autoMatchUnavailable,
                      context: "settings",
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
