import {
  registerSettingsCommand,
  SettingsDetailEditor,
  type SettingsDetailField,
  type SettingsSection,
} from "@aliou/pi-utils-settings";
import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { ApertureClient } from "../../src/api/client";
import {
  mapDedicatedProviders,
  mapProxyProviders,
} from "../../src/provider-mapping";
import type {
  ApertureConfig,
  DedicatedProviderConfig,
  ResolvedConfig,
} from "../../src/shared/config/loader";
import { configLoader } from "../../src/shared/config/loader";
import { normalizeInputUrl } from "../../src/url";

function boolLabel(value: boolean): string {
  return value ? "enabled" : "disabled";
}

class AsyncEditor implements Component {
  private editor: Component | null = null;
  private error = "";

  constructor(loader: () => Promise<Component>) {
    void loader()
      .then((editor) => {
        this.editor = editor;
      })
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : String(error);
      });
  }

  render(width: number): string[] {
    if (this.editor) return this.editor.render(width);
    if (this.error) return [`Failed to refresh providers: ${this.error}`];
    return ["Refreshing providers from Aperture..."];
  }

  invalidate(): void {
    this.editor?.invalidate?.();
  }

  handleInput(data: string): void {
    this.editor?.handleInput?.(data);
  }
}

export function registerApertureSettings(
  pi: ExtensionAPI,
  onSync: (ctx: ExtensionContext) => void,
  getKnownModels: () => Model<Api>[],
): void {
  registerSettingsCommand<ApertureConfig, ResolvedConfig>(pi, {
    commandName: "aperture:settings",
    title: "Aperture Settings",
    configStore: configLoader,
    buildSections: (tabConfig, resolved, { setDraft }): SettingsSection[] => {
      const draft = tabConfig ?? {};
      const baseUrl = draft.baseUrl ?? resolved.baseUrl;
      const proxyEnabled = draft.proxy?.enabled ?? resolved.proxy.enabled;
      const dedicatedEnabled =
        draft.dedicated?.enabled ?? resolved.dedicated.enabled;
      const upstreamProviders =
        draft.proxy?.upstreamProviders ?? resolved.proxy.upstreamProviders;
      const dedicatedProviders =
        draft.dedicated?.providers ?? resolved.dedicated.providers;
      const connectorsEnabled =
        draft.features?.connectors ?? resolved.features.connectors;
      const onboardingDone = draft.onboardingDone ?? resolved.onboardingDone;
      const onboardingEnabled =
        draft.onboarding?.enabled ?? resolved.onboarding.enabled;

      return [
        {
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
                      setDraft(updated);
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
                  theme: getSettingsListTheme(),
                  onDone: (summary) =>
                    submenuDone(summary ?? (currentUrl || "(not set)")),
                  getDoneSummary: () => currentUrl || "(not set)",
                });
              },
            },
          ],
        },
        {
          label: "Capabilities",
          items: [
            {
              id: "proxy.enabled",
              label: "Proxy existing providers",
              description: "Route selected Pi providers through Aperture",
              currentValue: boolLabel(proxyEnabled),
              values: ["enabled", "disabled"],
            },
            {
              id: "dedicated.enabled",
              label: "Dedicated Aperture provider",
              description: "Register a standalone aperture provider",
              currentValue: boolLabel(dedicatedEnabled),
              values: ["enabled", "disabled"],
            },
            {
              id: "features.connectors",
              label: "Connector tools",
              description: "Register MCP connector tools from Aperture",
              currentValue: boolLabel(connectorsEnabled),
              values: ["enabled", "disabled"],
            },
          ],
        },
        {
          label: "Proxy",
          items: [
            {
              id: "proxy.upstreamProviders",
              label: "Upstream providers",
              description: "Configured proxy providers and gateway checks",
              currentValue:
                upstreamProviders.length > 0
                  ? `${upstreamProviders.length} provider(s)`
                  : "none",
              submenu: (_val, submenuDone) =>
                new AsyncEditor(async () => {
                  const client = new ApertureClient(baseUrl);
                  const [providerInfos, gatewayProviders] = await Promise.all([
                    client.providerConfigInfos(),
                    client.providers(),
                  ]);
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
                    setDraft(updated);
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
                          setDraft(updated);
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
                          setDraft(updated);
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
                    theme: getSettingsListTheme(),
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
                }),
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
                "Gateway providers included in the aperture provider",
              currentValue:
                dedicatedProviders.length > 0
                  ? `${dedicatedProviders.filter((p) => p.enabled).length}/${dedicatedProviders.length} enabled`
                  : "all (no filter)",
              submenu: (_val, submenuDone) =>
                new AsyncEditor(async () => {
                  const gatewayProviders = await new ApertureClient(
                    baseUrl,
                  ).providers();
                  const providers: DedicatedProviderConfig[] =
                    mapDedicatedProviders(gatewayProviders, dedicatedProviders);
                  {
                    const updated = structuredClone(draft) as ApertureConfig;
                    updated.dedicated = {
                      ...updated.dedicated,
                      providers,
                    };
                    setDraft(updated);
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
                    theme: getSettingsListTheme(),
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
                }),
            },
          ],
        },
        {
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
        },
      ];
    },
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
      if (id === "features.connectors")
        updated.features = {
          ...updated.features,
          connectors: newValue === "enabled",
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
