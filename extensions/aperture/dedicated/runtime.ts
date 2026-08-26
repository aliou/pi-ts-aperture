import type {
  Api,
  Model,
  ModelsStoreEntry,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import { getBaseUrlForApi } from "../../../src/base-url-routing";
import {
  fetchModelsDevCatalog,
  type ModelsDevCatalog,
  resolveModelMetadata,
} from "../../../src/model-metadata";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../../src/url";
import {
  getApiForCompatibility,
  isSelectableApi,
} from "../../shared/api-selection";
import { configLoader, type ResolvedConfig } from "../../shared/config/loader";
import { buildDefaultModelConfig } from "./model-defaults";
import {
  buildDedicatedProviderConfig,
  DEDICATED_PROVIDER_ID,
} from "./provider";

const PROVIDER_NAME = DEDICATED_PROVIDER_ID;

/**
 * Supplier of Pi's native registry models, used for upstream base URL
 * inference and capability metadata. It is a function because refreshes read
 * the registry at call time: the extension factory registers the provider
 * before any registry access exists (`session_start` provides it), and later
 * refreshes must see a live view, not a snapshot.
 */
export type GetRegistryModels = () => Model<Api>[];

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
function buildCatalogKey(gatewayUrl: string, config: ResolvedConfig): string {
  let origin: string;
  try {
    origin = new URL(gatewayUrl).origin;
  } catch {
    origin = gatewayUrl;
  }
  const enabled = config.dedicated.providers
    .filter((p) => p.enabled)
    .map((p) => (p.api ? `${p.id}@${p.api}` : p.id))
    .sort();
  const filter =
    config.dedicated.providers.length === 0 ? "*" : enabled.join(",");
  return `${origin} ${filter} v2`;
}

function filterProviders(
  providers: ApertureProvider[],
  config: ResolvedConfig,
): ApertureProvider[] {
  const selected = new Set(
    config.dedicated.providers.filter((p) => p.enabled).map((p) => p.id),
  );
  return config.dedicated.providers.length > 0
    ? providers.filter((provider) => selected.has(provider.id))
    : providers;
}

function buildModels(
  providers: ApertureProvider[],
  gatewayUrl: string,
  baseUrl: string,
  registryModels: Model<Api>[],
  modelsDev: ModelsDevCatalog | null,
  apiOverrides: ReadonlyMap<string, Api>,
  notify?: (warning: string) => void,
): Model<Api>[] {
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
  const metadataRegistry = registryModels.filter(
    (m) => m.provider !== PROVIDER_NAME,
  );

  const models: Model<Api>[] = [];

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
      const modelInfo = provider.modelInfoById?.[modelId];
      // Fall back to a model-id lookup when the provider id does not match a
      // native Pi provider (e.g. a custom Aperture provider name).
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
          providerId: provider.id,
          provider: { id: provider.id, name: provider.name },
          pricing: modelInfo?.pricing,
          metadata,
        }),
        api,
        baseUrl: getBaseUrlForApi(api, gatewayUrl, baseUrl, upstreamBaseUrl),
      } as Model<Api>);
    }
  }

  return models;
}

function normalizeDedicatedModels(models: ProviderModelConfig[]): Model<Api>[] {
  return models.map(
    (model) =>
      ({
        ...model,
        provider: (model as Partial<Model<Api>>).provider ?? PROVIDER_NAME,
      }) as Model<Api>,
  );
}

/**
 * Cache-only restore from the persisted catalog snapshot. Returns `[]` when
 * the snapshot is empty, predates the catalog key, or was written for a
 * different catalog identity (gateway origin or dedicated provider selection
 * changed).
 */
function storedCatalogModels(
  stored: ModelsStoreEntry | undefined,
  catalogKey: string,
): Model<Api>[] {
  try {
    const entry = stored as DedicatedStoreEntry | undefined;
    if (!entry || !Array.isArray(entry.models)) return [];
    if (entry.catalogKey !== catalogKey) return [];
    return normalizeDedicatedModels(
      entry.models as unknown as ProviderModelConfig[],
    );
  } catch {
    return [];
  }
}

/**
 * Fetch the gateway catalog and build the model list. No store interaction,
 * so it serves hosts that cache the catalog themselves (omp's
 * `fetchDynamicModels`) as well as the networked half of
 * {@link refreshDedicatedCatalog}.
 *
 * Reads config live at call time so settings changes (gateway URL, provider
 * filter) apply on the next fetch without re-registering.
 */
export async function fetchDedicatedCatalog(
  getModels: GetRegistryModels,
  notify?: (warning: string) => void,
  signal?: AbortSignal,
): Promise<Model<Api>[]> {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled) return [];
  const gatewayUrl = resolveGatewayUrl(config);
  const baseUrl = resolveProviderBaseUrl(config);
  if (!gatewayUrl || !baseUrl) return [];

  const client = new ApertureClient(gatewayUrl);
  const [gatewayProviders, modelsDev] = await Promise.all([
    client.providers(signal),
    fetchModelsDevCatalog({ signal }),
  ]);
  const providers = filterProviders(gatewayProviders, config);
  const apiOverrides = new Map(
    config.dedicated.providers
      .filter((p) => p.enabled && p.api)
      .map((p) => [p.id, p.api as Api]),
  );
  return buildModels(
    providers,
    gatewayUrl,
    baseUrl,
    getModels(),
    modelsDev,
    apiOverrides,
    notify,
  );
}

/**
 * Refresh the dedicated model list. Called by Pi with `allowNetwork: false`
 * right after registration (cache-only restore, before scope validation) and
 * with network access when `ctx.modelRegistry.refresh()` runs.
 *
 * Builds and persists the dedicated catalog: restores the `context.stored`
 * snapshot on cache-only refreshes, and on networked refreshes fetches the
 * gateway catalog, builds models, and publishes the store entry
 * (`context.publish({ persist })`). Fetch failures propagate so Pi reports
 * them through ModelsRefreshResult.errors; the caller retains the previous
 * model list.
 *
 * Reads config live at call time so settings changes (gateway URL, provider
 * filter) apply on the next refresh without re-registering.
 */
export async function refreshDedicatedCatalog(
  context: RefreshModelsContext,
  getModels: GetRegistryModels,
  notify?: (warning: string) => void,
): Promise<Model<Api>[]> {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled) return [];
  const gatewayUrl = resolveGatewayUrl(config);
  if (!gatewayUrl || !resolveProviderBaseUrl(config)) return [];

  const catalogKey = buildCatalogKey(gatewayUrl, config);

  if (!context.allowNetwork) {
    return storedCatalogModels(context.stored, catalogKey);
  }

  const catalog = await fetchDedicatedCatalog(
    getModels,
    notify,
    context.signal,
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

/**
 * Register the dedicated `aperture` provider by name + config.
 *
 * pi drives the catalog through `refreshModels`: it fires a cache-only
 * refresh right after registration, restoring the previous catalog from
 * `models-store.json` so scoped models validate during startup, then
 * `session_start` triggers the networked revalidation. Hosts without
 * `refreshModels` (omp) call `fetchDynamicModels` and cache the result
 * themselves.
 *
 * No-ops when dedicated is disabled or the gateway URL is unset.
 */
export function registerDedicatedProvider(
  pi: Pick<ExtensionAPI, "registerProvider">,
  getModels: GetRegistryModels,
  notify?: (warning: string) => void,
  headers?: Record<string, string>,
): void {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled) return;

  const baseUrl = resolveProviderBaseUrl(config);
  if (!baseUrl) return;

  pi.registerProvider(
    PROVIDER_NAME,
    buildDedicatedProviderConfig({
      baseUrl,
      headers,
      refreshModels: (context) =>
        refreshDedicatedCatalog(context, getModels, notify),
      fetchCatalog: () => fetchDedicatedCatalog(getModels, notify),
    }),
  );
}

/**
 * Reconcile registration with the current config: registers (or re-registers,
 * picking up a changed gateway base URL) when dedicated is enabled, and
 * unregisters when it is disabled or the gateway URL is unset.
 */
export function reconcileDedicatedProvider(
  pi: Pick<ExtensionAPI, "registerProvider" | "unregisterProvider">,
  getModels: GetRegistryModels,
  notify?: (warning: string) => void,
  headers?: Record<string, string>,
): void {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled || !resolveProviderBaseUrl(config)) {
    pi.unregisterProvider(PROVIDER_NAME);
    return;
  }
  registerDedicatedProvider(pi, getModels, notify, headers);
}
