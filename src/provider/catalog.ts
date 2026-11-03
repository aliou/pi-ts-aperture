import type {
  AnyModel,
  Api,
  ClassifierApi,
  ClassifierModel,
  Model,
  ModelsStoreEntry,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { getModelType } from "@earendil-works/pi-ai";
import { ApertureClient } from "../api/client";
import type { ApertureProvider } from "../api/types";
import { getApiForCompatibility, isSelectableApi } from "../api-selection";
import { getBaseUrlForApi } from "../base-url-routing";
import {
  buildClassifierModelConfig,
  buildDefaultModelConfig,
} from "../model-defaults";
import {
  fetchModelsDevCatalog,
  type ModelsDevCatalog,
  resolveModelMetadata,
} from "../model-metadata";
import { APERTURE_SYSTEM_ONE_API } from "../system-one";
import { DEDICATED_PROVIDER_ID } from "./dedicated";

const PROVIDER_NAME = DEDICATED_PROVIDER_ID;

/**
 * Dedicated-provider selection: which gateway providers to include and which
 * Pi API routes their models. Structurally the extension's
 * `DedicatedProviderConfig`; declared locally so `src/` stays free of
 * extension imports.
 */
export interface DedicatedProviderSelection {
  id: string;
  enabled: boolean;
  api?: Api;
}

/**
 * Store entry with the catalog identity it was built for. Restores are only
 * valid when the identity still matches the current config; a catalog for a
 * different gateway or provider selection must not be replayed.
 */
type DedicatedStoreEntry = ModelsStoreEntry & { catalogKey?: string };

/**
 * Identity of the catalog a store entry was built from: gateway origin plus
 * the normalized dedicated provider filter, with api overrides recorded as
 * `id@api` so a catalog stamped for a different routing api never replays.
 * Comparing keys on cache-only restore rejects catalogs for a different
 * gateway (origin equality, not a string prefix, so `gateway.example.evil`
 * never matches `gateway.example`) or provider selection.
 */
export function buildCatalogKey(
  gatewayUrl: string,
  providers: readonly DedicatedProviderSelection[],
): string {
  let origin: string;
  try {
    origin = new URL(gatewayUrl).origin;
  } catch {
    origin = gatewayUrl;
  }
  const enabled = providers
    .filter((p) => p.enabled)
    .map((p) => {
      const base = p.api ? `${p.id}@${p.api}` : p.id;
      return base;
    })
    .sort();
  const filter = providers.length === 0 ? "*" : enabled.join(",");
  return `${origin} ${filter} v3`;
}

export function filterProviders(
  providers: ApertureProvider[],
  selection: readonly DedicatedProviderSelection[],
): ApertureProvider[] {
  // Passthrough providers require a client credential Aperture cannot
  // inject; the dedicated provider never sends one, so their models cannot
  // be called. Exclude them regardless of the configured filter.
  const callable = providers.filter(
    (provider) => !provider.requires_client_auth,
  );
  const selected = new Set(selection.filter((p) => p.enabled).map((p) => p.id));
  return selection.length > 0
    ? callable.filter((provider) => selected.has(provider.id))
    : callable;
}

export function buildModels(
  providers: ApertureProvider[],
  gatewayUrl: string,
  baseUrl: string,
  registryModels: readonly AnyModel[],
  modelsDev: ModelsDevCatalog | null,
  apiOverrides: ReadonlyMap<string, Api>,
  notify?: (warning: string) => void,
): AnyModel[] {
  // Look up native upstream base URLs from Pi's model registry. Prefer a
  // provider-id match (same naming as the gateway), then a model-id match
  // (model ids are upstream-standardized, so they survive provider renaming).
  // Skip models already rewritten to the gateway (the dedicated `aperture`
  // provider and proxy-rewritten providers): only native upstream URLs are
  // useful signals for the /v1 inference.
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

  // Metadata matching excludes the dedicated provider's own registry entries:
  // they carry the safe defaults from a previous sync and would shadow real
  // metadata on re-sync. Proxy-rewritten providers keep their native model
  // definitions, so they stay useful for metadata.
  // Metadata fields only exist on chat models.
  const metadataRegistry = registryModels.filter(
    (m): m is Model<Api> =>
      getModelType(m) === "chat" && m.provider !== PROVIDER_NAME,
  );

  const models: AnyModel[] = [];

  for (const provider of providers) {
    const override = apiOverrides.get(provider.id);
    let api: Api;
    if (override && isSelectableApi(override, provider.compatibility)) {
      api = override;
    } else {
      if (override) {
        notify?.(
          `[aperture] api override "${override}" for dedicated provider ${provider.id} is not served by the gateway; using the auto-picked api.`,
        );
      }
      api = getApiForCompatibility(provider.compatibility);
    }
    const providerUpstream = upstreamByProvider.get(provider.id);
    for (const modelId of provider.models) {
      const modelInfo = provider.modelInfoById[modelId];
      // Fall back to a model-id lookup when the provider id does not match a
      // native Pi provider (e.g. a custom Aperture provider name).
      const upstreamBaseUrl = providerUpstream ?? upstreamByModel.get(modelId);
      const metadata = resolveModelMetadata(provider.id, modelId, {
        registryModels: metadataRegistry,
        modelsDev,
      });

      if (modelInfo?.system_one === true) {
        const classifier: ClassifierModel<ClassifierApi> = {
          provider: PROVIDER_NAME,
          type: "classifier",
          ...buildClassifierModelConfig({
            id: `${provider.id}/${modelId}`,
            name: modelId,
            pricing: modelInfo?.pricing,
            limits: {
              context_window_tokens: modelInfo?.context_window_tokens,
            },
            metadata,
          }),
          api: APERTURE_SYSTEM_ONE_API,
          baseUrl: getBaseUrlForApi(
            APERTURE_SYSTEM_ONE_API,
            gatewayUrl,
            baseUrl,
            upstreamBaseUrl,
          ),
        };
        models.push(classifier);
        continue;
      }

      const chat: Model<Api> = {
        provider: PROVIDER_NAME,
        ...buildDefaultModelConfig({
          id: `${provider.id}/${modelId}`,
          name: modelId,
          providerId: provider.id,
          provider: { id: provider.id, name: provider.name },
          pricing: modelInfo?.pricing,
          limits: {
            context_window_tokens: modelInfo?.context_window_tokens,
            max_output_tokens: modelInfo?.max_output_tokens,
          },
          metadata,
        }),
        api,
        baseUrl: getBaseUrlForApi(api, gatewayUrl, baseUrl, upstreamBaseUrl),
      };
      models.push(chat);
    }
  }

  return models;
}

/** Legacy store entries may omit `provider`; every model belongs to us. */
function withProviderDefaults(models: readonly AnyModel[]): AnyModel[] {
  return models.map((model) =>
    model.provider ? model : { ...model, provider: PROVIDER_NAME },
  );
}

/**
 * Cache-only restore from the persisted catalog snapshot. Returns `[]` when
 * the snapshot is empty, predates the catalog key, or was written for a
 * different catalog identity (gateway origin or dedicated provider selection
 * changed).
 */
export function storedCatalogModels(
  stored: ModelsStoreEntry | undefined,
  catalogKey: string,
): AnyModel[] {
  try {
    const entry = stored as DedicatedStoreEntry | undefined;
    if (!entry || !Array.isArray(entry.models)) return [];
    if (entry.catalogKey !== catalogKey) return [];
    return withProviderDefaults(entry.models);
  } catch {
    return [];
  }
}

export interface DedicatedCatalogOptions {
  gatewayUrl: string;
  baseUrl: string;
  /** Provider selection and api overrides (part of the catalog key). */
  providers: readonly DedicatedProviderSelection[];
  getRegistryModels: () => readonly AnyModel[];
  notify?: (warning: string) => void;
}

/**
 * Refresh the dedicated model list. Called with `allowNetwork: false` right
 * after registration (cache-only restore, before scope validation) and with
 * network access when a model-registry refresh runs.
 *
 * Builds and persists the dedicated catalog: restores the `context.stored`
 * snapshot on cache-only refreshes, and on networked refreshes fetches the
 * gateway catalog, builds models, and publishes the store entry
 * (`context.publish({ persist })`). Fetch failures propagate so the host
 * reports them; the caller retains the previous model list.
 */
export async function refreshDedicatedCatalog(
  context: RefreshModelsContext,
  options: DedicatedCatalogOptions,
): Promise<AnyModel[]> {
  const { gatewayUrl, baseUrl, providers, getRegistryModels, notify } = options;

  const catalogKey = buildCatalogKey(gatewayUrl, providers);

  if (!context.allowNetwork) {
    return storedCatalogModels(context.stored, catalogKey);
  }

  const client = new ApertureClient(gatewayUrl);
  const [gatewayProviders, modelsDev] = await Promise.all([
    client.providers(context.signal),
    fetchModelsDevCatalog({ signal: context.signal }),
  ]);
  const callable = filterProviders(gatewayProviders, providers);
  const apiOverrides = new Map(
    providers
      .filter((p) => p.enabled && p.api)
      .map((p) => [p.id, p.api as Api]),
  );
  const catalog = buildModels(
    callable,
    gatewayUrl,
    baseUrl,
    getRegistryModels(),
    modelsDev,
    apiOverrides,
    notify,
  );

  context.signal?.throwIfAborted();

  const entry: DedicatedStoreEntry = {
    models: catalog,
    checkedAt: Date.now(),
    catalogKey,
  };
  await context.publish({ persist: entry });
  return catalog;
}
