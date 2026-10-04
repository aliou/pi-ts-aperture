import type {
  Api,
  Model,
  ModelsStoreEntry,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { ApertureClient } from "../api/client";
import type { ApertureProvider } from "../api/types";
import { getBaseUrlForApi } from "../base-url-routing";
import {
  fetchModelsDevCatalog,
  type ModelsDevCatalog,
  resolveModelMetadata,
} from "../model-metadata";
import type { ApertureProviderOptions } from "../provider";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../url";
import { getApiForCompatibility, isSelectableApi } from "./api-selection";
import { buildDefaultModelConfig } from "./model-defaults";

const PROVIDER_NAME = "aperture";

type DedicatedStoreEntry = ModelsStoreEntry & { catalogKey?: string };

// Catalog identity includes the gateway, provider filters, and API overrides.
function buildCatalogKey(
  gatewayUrl: string,
  config: ApertureProviderOptions,
): string {
  let origin: string;
  try {
    origin = new URL(gatewayUrl).origin;
  } catch {
    origin = gatewayUrl;
  }
  const enabled = (config.providers ?? [])
    .filter((p) => p.enabled)
    .map((p) => (p.api ? `${p.id}@${p.api}` : p.id))
    .sort();
  const filter =
    (config.providers ?? []).length === 0 ? "*" : enabled.join(",");
  return `${origin} ${filter} v2`;
}

function filterProviders(
  providers: ApertureProvider[],
  config: ApertureProviderOptions,
): ApertureProvider[] {
  const callable = providers.filter(
    (provider) => !provider.requires_client_auth,
  );
  const selected = new Set(
    (config.providers ?? []).filter((p) => p.enabled).map((p) => p.id),
  );
  return (config.providers ?? []).length > 0
    ? callable.filter((provider) => selected.has(provider.id))
    : callable;
}

function selectApi(
  provider: ApertureProvider,
  override: Api | undefined,
  notify?: (warning: string) => void,
): Api {
  if (!override) return getApiForCompatibility(provider.compatibility);
  if (isSelectableApi(override, provider.compatibility)) return override;
  notify?.(
    `[aperture] api override "${override}" for dedicated provider ${provider.id} is not served by the gateway; using the auto-picked api.`,
  );
  return getApiForCompatibility(provider.compatibility);
}

function buildModels(
  providers: ApertureProvider[],
  gatewayUrl: string,
  baseUrl: string,
  registryModels: readonly Model<Api>[],
  modelsDev: ModelsDevCatalog | null,
  apiOverrides: ReadonlyMap<string, Api>,
  notify?: (warning: string) => void,
): Model<Api>[] {
  const upstreamByProvider = new Map<string, string>();
  const upstreamByModel = new Map<string, string>();
  for (const m of registryModels) {
    if (!m.baseUrl) continue;
    if (m.baseUrl === gatewayUrl || m.baseUrl === baseUrl) continue;
    if (m.provider && !upstreamByProvider.has(m.provider)) {
      upstreamByProvider.set(m.provider, m.baseUrl);
    }
    if (!upstreamByModel.has(m.id)) {
      upstreamByModel.set(m.id, m.baseUrl);
    }
  }
  // Prior Aperture defaults must not shadow native metadata.
  const metadataRegistry = registryModels.filter(
    (m) => m.provider !== PROVIDER_NAME,
  );

  const models: Model<Api>[] = [];

  for (const provider of providers) {
    const override = apiOverrides.get(provider.id);
    const api = selectApi(provider, override, notify);
    const providerUpstream = upstreamByProvider.get(provider.id);
    for (const modelId of provider.models) {
      const modelInfo = provider.modelInfoById[modelId];
      const upstreamBaseUrl = providerUpstream ?? upstreamByModel.get(modelId);
      const metadata = resolveModelMetadata(provider.id, modelId, {
        registryModels: metadataRegistry,
        modelsDev,
      });
      models.push({
        provider: PROVIDER_NAME,
        ...buildDefaultModelConfig({
          id: `${provider.id}/${modelId}`,
          name: modelId,
          pricing: modelInfo?.pricing,
          metadata,
        }),
        api,
        baseUrl: getBaseUrlForApi(api, gatewayUrl, baseUrl, upstreamBaseUrl),
      });
    }
  }

  return models;
}

function normalizeDedicatedModels(models: Model<Api>[]): Model<Api>[] {
  return models.map((model) => ({
    ...model,
    provider: model.provider ?? PROVIDER_NAME,
  }));
}

function storedCatalogModels(
  stored: ModelsStoreEntry | undefined,
  catalogKey: string,
): Model<Api>[] {
  try {
    const entry = stored as DedicatedStoreEntry | undefined;
    if (!entry || !Array.isArray(entry.models)) return [];
    if (entry.catalogKey !== catalogKey) return [];
    return normalizeDedicatedModels(entry.models as Model<Api>[]);
  } catch {
    return [];
  }
}

export async function refreshApertureCatalog(
  context: RefreshModelsContext,
  config: ApertureProviderOptions,
): Promise<Model<Api>[]> {
  const gatewayUrl = resolveGatewayUrl(config);
  const baseUrl = resolveProviderBaseUrl(config);
  if (!gatewayUrl || !baseUrl) return [];

  const catalogKey = buildCatalogKey(gatewayUrl, config);

  if (!context.allowNetwork) {
    return storedCatalogModels(context.stored, catalogKey);
  }

  const client = new ApertureClient(gatewayUrl);
  const [gatewayProviders, modelsDev] = await Promise.all([
    client.providers(context.signal),
    fetchModelsDevCatalog({ signal: context.signal }),
  ]);
  const providers = filterProviders(gatewayProviders, config);
  const apiOverrides = new Map(
    (config.providers ?? [])
      .filter((p) => p.enabled && p.api)
      .map((p) => [p.id, p.api as Api]),
  );
  const catalog = buildModels(
    providers,
    gatewayUrl,
    baseUrl,
    config.getRegistryModels?.() ?? [],
    modelsDev,
    apiOverrides,
    config.onWarning,
  );

  context.signal.throwIfAborted();

  const entry: DedicatedStoreEntry = {
    models: catalog,
    checkedAt: Date.now(),
    catalogKey,
  };
  await context.publish({ persist: entry });
  return catalog;
}
