import {
  type ExtraSettingsTab,
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
  type SettingsSubmenuContext,
} from "@aliou/pi-utils-settings";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Component } from "@earendil-works/pi-tui";
import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import { isSelectableApi } from "../../shared/api-selection";
import type {
  ApertureConfig,
  ProxiedProviderConfig,
  ResolvedConfig,
} from "../../shared/config/loader";
import { mapGatewayProxyProviders } from "../../shared/provider-mapping";
import { AsyncEditor } from "./async-editor";
import { LocalProviderSelector } from "./local-provider-selector";
import {
  apiSelectionField,
  boolLabel,
  GLOBAL_SCOPE,
  getTabConfig,
  providerSummary,
  SETTINGS_CONTENT_HEIGHT,
} from "./shared";

/** The gateway catalog bounds the visible list; local providers appear only in pickers. */
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
                "Pair gateway providers with local Pi providers and configure routing",
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
                    const gatewayProviders = await new ApertureClient(
                      baseUrl,
                    ).providers(signal);
                    const localModels = getKnownModels();
                    const localIds = [
                      ...new Set(
                        localModels
                          .map((model) => model.provider)
                          .filter((id) => id !== "aperture"),
                      ),
                    ].sort((a, b) => a.localeCompare(b));
                    const rows = mapGatewayProxyProviders(
                      localModels,
                      gatewayProviders,
                      upstreamProviders,
                    );
                    const entries = new Map(
                      upstreamProviders.map((entry) => [
                        entry.id,
                        { ...entry },
                      ]),
                    );
                    const excludedDefaults = new Set<string>();
                    const persistProviders = () => {
                      const updated = structuredClone(draft) as ApertureConfig;
                      updated.proxy = {
                        ...updated.proxy,
                        upstreamProviders: [...entries.values()],
                      };
                      setDraftForScope(GLOBAL_SCOPE, updated);
                    };
                    const pairedIds = (gatewayId: string) =>
                      localIds.filter(
                        (id) => entries.get(id)?.gatewayId === gatewayId,
                      );
                    const selectedIds = (provider: ApertureProvider) => {
                      const ids = pairedIds(provider.id);
                      return ids.length > 0
                        ? ids
                        : localIds.includes(provider.id) &&
                            !entries.has(provider.id) &&
                            !excludedDefaults.has(provider.id)
                          ? [provider.id]
                          : [];
                    };
                    const updateSelection = (
                      provider: ApertureProvider,
                      ids: string[],
                      enableNew = true,
                    ) => {
                      if (ids.includes(provider.id)) {
                        excludedDefaults.delete(provider.id);
                      } else {
                        excludedDefaults.add(provider.id);
                      }
                      for (const id of pairedIds(provider.id)) {
                        if (ids.includes(id)) continue;
                        entries.delete(id);
                      }
                      for (const id of ids) {
                        const previous = entries.get(id);
                        if (previous?.gatewayId === provider.id) continue;
                        entries.set(id, {
                          ...previous,
                          id,
                          gatewayId: provider.id,
                          enabled: previous?.enabled ?? enableNew,
                          shouldCheckGatewayModels:
                            previous?.shouldCheckGatewayModels ?? true,
                          keepGatewayModelsOnly:
                            previous?.keepGatewayModelsOnly ?? false,
                          api:
                            previous?.api &&
                            isSelectableApi(
                              previous.api,
                              provider.compatibility,
                            )
                              ? previous.api
                              : undefined,
                        });
                      }
                      persistProviders();
                    };
                    const rowSummary = (provider: ApertureProvider) => {
                      const ids = selectedIds(provider);
                      if (ids.length === 0) return "select";
                      if (ids.length > 1) {
                        const active = ids.filter((id) => {
                          const entry = entries.get(id);
                          return entry !== undefined && entry.enabled !== false;
                        }).length;
                        return `${active}/${ids.length} enabled`;
                      }
                      const id = ids[0];
                      const entry = entries.get(id);
                      const status = providerSummary(
                        entry !== undefined && entry.enabled !== false,
                        entry?.api,
                      );
                      return id === provider.id ? status : `${status} · ${id}`;
                    };
                    const openProvider = (
                      provider: ApertureProvider,
                      done: () => void,
                      providerCtx: SettingsSubmenuContext,
                    ): Component & { getShortcuts: () => string } => {
                      let current: Component;
                      const selected = () => selectedIds(provider);
                      const edit = (
                        id: string,
                        update: (entry: ProxiedProviderConfig) => void,
                      ) => {
                        updateSelection(provider, selected(), false);
                        const entry = entries.get(id);
                        if (!entry) return;
                        update(entry);
                        persistProviders();
                      };
                      const selector = (
                        submit: (ids: string[]) => void,
                        cancel: () => void,
                      ) =>
                        new LocalProviderSelector(
                          provider.name ?? provider.id,
                          localIds,
                          selected(),
                          settingsTheme,
                          providerCtx.hideHint ?? false,
                          submit,
                          cancel,
                        );
                      const options = (id: string): SettingsDetailField[] => {
                        const apiField = apiSelectionField({
                          id: `provider.${id}.api`,
                          compatibility: provider.compatibility,
                          getValue: () => entries.get(id)?.api,
                          setValue: (api) =>
                            edit(id, (entry) => {
                              entry.api = api;
                            }),
                        });
                        return [
                          {
                            type: "boolean",
                            id: `provider.${id}.enabled`,
                            label: "Proxy this provider",
                            description: `Route local ${id} through Aperture`,
                            getValue: () =>
                              entries.get(id) !== undefined &&
                              entries.get(id)?.enabled !== false,
                            setValue: (value) =>
                              edit(id, (entry) => {
                                entry.enabled = value;
                              }),
                            trueLabel: "enabled",
                            falseLabel: "disabled",
                          },
                          {
                            type: "boolean",
                            id: `provider.${id}.shouldCheckGatewayModels`,
                            label: "Gateway model check",
                            description:
                              "Warn when configured local models are missing from the gateway catalog",
                            getValue: () =>
                              entries.get(id)?.shouldCheckGatewayModels ?? true,
                            setValue: (value) =>
                              edit(id, (entry) => {
                                entry.shouldCheckGatewayModels = value;
                              }),
                            trueLabel: "on",
                            falseLabel: "off",
                          },
                          {
                            type: "boolean",
                            id: `provider.${id}.keepGatewayModelsOnly`,
                            label: "Gateway models only",
                            description:
                              "Register only the models the gateway serves instead of all locally known models",
                            getValue: () =>
                              entries.get(id)?.keepGatewayModelsOnly ?? false,
                            setValue: (value) =>
                              edit(id, (entry) => {
                                entry.keepGatewayModelsOnly = value;
                              }),
                            trueLabel: "on",
                            falseLabel: "off",
                          },
                          ...(apiField ? [apiField] : []),
                        ];
                      };
                      const settings = () => {
                        const ids = selected();
                        const fields: SettingsDetailField[] = [
                          {
                            type: "submenu",
                            id: `gateway.${provider.id}.local`,
                            label: "Local Pi providers",
                            description:
                              "Select the local providers routed through this gateway provider",
                            getValue: () => selected().join(", ") || "select",
                            submenu: (close) =>
                              selector(
                                (ids) => {
                                  updateSelection(provider, ids);
                                  close();
                                  current = settings();
                                },
                                () => close(),
                              ),
                          },
                          ...(ids.length === 1
                            ? options(ids[0])
                            : ids.map(
                                (id): SettingsDetailField => ({
                                  type: "submenu",
                                  id: `provider.${id}`,
                                  label: id,
                                  description: `Routing options for local ${id}`,
                                  getValue: () =>
                                    providerSummary(
                                      entries.get(id)?.enabled !== false,
                                      entries.get(id)?.api,
                                    ),
                                  submenu: (close, ctx) =>
                                    new SettingsDetailEditor({
                                      title: `${id} → ${provider.id}`,
                                      fields: options(id),
                                      theme: settingsTheme,
                                      requestRender: ctx.requestRender,
                                      hideHint: ctx.hideHint,
                                      contentHeight: SETTINGS_CONTENT_HEIGHT,
                                      onDone: () => close(),
                                    }),
                                }),
                              )),
                        ];
                        return new SettingsDetailEditor({
                          title: provider.name ?? provider.id,
                          fields,
                          theme: settingsTheme,
                          requestRender: providerCtx.requestRender,
                          hideHint: providerCtx.hideHint,
                          contentHeight: SETTINGS_CONTENT_HEIGHT,
                          onDone: () => done(),
                        });
                      };
                      current =
                        selected().length > 0
                          ? settings()
                          : selector((ids) => {
                              updateSelection(provider, ids);
                              current = settings();
                            }, done);
                      return {
                        render: (width) => current.render(width),
                        handleInput: (data) => current.handleInput?.(data),
                        invalidate: () => current.invalidate?.(),
                        getShortcuts: () =>
                          (
                            current as Component & {
                              getShortcuts?: () => string;
                            }
                          ).getShortcuts?.() ?? "",
                      };
                    };
                    const fields: SettingsDetailField[] = rows.map(
                      ({ provider }) => ({
                        type: "submenu",
                        id: `gateway.${provider.id}`,
                        label: provider.name ?? provider.id,
                        description: provider.id,
                        getValue: () => rowSummary(provider),
                        submenu: (done, providerCtx) =>
                          openProvider(provider, () => done(), providerCtx),
                      }),
                    );
                    return new SettingsDetailEditor({
                      title: () =>
                        `Upstream Providers (${rows.filter(({ provider }) => pairedIds(provider.id).some((id) => entries.get(id)?.enabled !== false)).length}/${rows.length} enabled)`,
                      fields,
                      theme: settingsTheme,
                      requestRender: submenuCtx.requestRender,
                      hideHint: loaderCtx.hideHint,
                      contentHeight: SETTINGS_CONTENT_HEIGHT,
                      onDone: () => submenuDone(`${entries.size} configured`),
                      getDoneSummary: () => `${entries.size} configured`,
                      emptyStateText: "No gateway providers found.",
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
