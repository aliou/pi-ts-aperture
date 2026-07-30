import type {
  Api,
  Model,
  ModelsStoreEntry,
  ProviderModelsStore,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import {
  fetchModelsDevCatalog,
  type ModelsDevCatalog,
  resolveModelMetadata,
} from "../../../src/model-metadata";
import {
  configLoader,
  type ResolvedConfig,
} from "../../../src/shared/config/loader";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../../src/url";
import {
  buildStreamSimple,
  getApiForCompatibility,
  getBaseUrlForApi,
} from "./api-routing";
import { buildDefaultModelConfig } from "./model-defaults";

const PROVIDER_NAME = "aperture";
const APERTURE_API = "aperture";

/**
 * Supplier of Pi's native registry models, used for upstream base URL
 * inference and capability metadata. It is a function because refreshes read
 * the registry at call time: the extension factory registers the provider
 * before any registry access exists (`session_start` provides it), and later
 * refreshes must see a live view, not a snapshot.
 */
export type GetRegistryModels = () => Model<Api>[];

/** Model config with the upstream Pi API embedded for stream-time routing. */
type DedicatedModelConfig = ProviderModelConfig & { upstreamApi: Api };

/**
 * Store entry with the catalog identity it was built for. Restores are only
 * valid when the identity still matches the current config; a catalog for a
 * different gateway or provider selection must not be replayed.
 */
type DedicatedStoreEntry = ModelsStoreEntry & { catalogKey?: string };

/**
 * Identity of the catalog a store entry was built from: gateway origin plus
 * the normalized dedicated provider filter. Comparing keys on cache-only
 * restore rejects catalogs for a different gateway (origin equality, not a
 * string prefix, so `gateway.example.evil` never matches `gateway.example`)
 * and catalogs built under a different provider selection.
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
    .map((p) => p.id)
    .sort();
  const filter =
    config.dedicated.providers.length === 0 ? "*" : enabled.join(",");
  return `${origin} ${filter}`;
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
): DedicatedModelConfig[] {
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

  const models: DedicatedModelConfig[] = [];

  for (const provider of providers) {
    const api = getApiForCompatibility(provider.compatibility);
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
        ...buildDefaultModelConfig({
          id: modelId,
          providerId: provider.id,
          provider: { id: provider.id, name: provider.name },
          pricing: modelInfo?.pricing,
          metadata,
        }),
        api: APERTURE_API,
        baseUrl: getBaseUrlForApi(api, gatewayUrl, baseUrl, upstreamBaseUrl),
        upstreamApi: api,
      });
    }
  }

  return models;
}

/**
 * Cache-only restore from Pi's models store. Returns `[]` when the store is
 * empty, predates the catalog key, or was written for a different catalog
 * identity (gateway origin or dedicated provider selection changed).
 */
async function readStoredModels(
  store: ProviderModelsStore,
  catalogKey: string,
): Promise<ProviderModelConfig[]> {
  try {
    const stored = await store.read();
    const entry = stored as DedicatedStoreEntry | undefined;
    if (!entry || !Array.isArray(entry.models)) return [];
    if (entry.catalogKey !== catalogKey) return [];
    return [...(entry.models as unknown as ProviderModelConfig[])];
  } catch {
    return [];
  }
}

/**
 * Refresh the dedicated model list. Called by Pi with `allowNetwork: false`
 * right after registration (cache-only restore, before scope validation) and
 * with network access when `ctx.modelRegistry.refresh()` runs.
 *
 * Reads config live at call time so settings changes (gateway URL, provider
 * filter) apply on the next refresh without re-registering.
 */
async function refreshDedicatedModels(
  context: RefreshModelsContext,
  getModels: GetRegistryModels,
): Promise<ProviderModelConfig[]> {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled) return [];
  const gatewayUrl = resolveGatewayUrl(config);
  const baseUrl = resolveProviderBaseUrl(config);
  if (!gatewayUrl || !baseUrl) return [];

  const catalogKey = buildCatalogKey(gatewayUrl, config);

  if (!context.allowNetwork) {
    return readStoredModels(context.store, catalogKey);
  }

  const client = new ApertureClient(gatewayUrl);
  const [gatewayProviders, modelsDev] = await Promise.all([
    client.providers(context.signal),
    fetchModelsDevCatalog({ signal: context.signal }),
  ]);
  const providers = filterProviders(gatewayProviders, config);
  const models = buildModels(
    providers,
    gatewayUrl,
    baseUrl,
    getModels(),
    modelsDev,
  );

  const entry: DedicatedStoreEntry = {
    models: models as unknown as Model<Api>[],
    checkedAt: Date.now(),
    catalogKey,
  };
  await context.store.write(entry);
  return models;
}

/**
 * Register the dedicated `aperture` provider with a `refreshModels` hook.
 *
 * Pi immediately fires a cache-only refresh after registration, restoring the
 * previous catalog from `models-store.json` so scoped models validate during
 * startup. The networked revalidation happens when `session_start` calls
 * `ctx.modelRegistry.refresh()`.
 *
 * No-ops when dedicated is disabled or the gateway URL is unset.
 */
export function registerDedicatedProvider(
  pi: Pick<ExtensionAPI, "registerProvider">,
  getModels: GetRegistryModels,
): void {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled) return;

  const baseUrl = resolveProviderBaseUrl(config);
  if (!baseUrl) return;

  pi.registerProvider(PROVIDER_NAME, {
    baseUrl,
    apiKey: "-",
    api: APERTURE_API,
    streamSimple: buildStreamSimple(),
    refreshModels: (context) => refreshDedicatedModels(context, getModels),
  });
}

/**
 * Reconcile registration with the current config: registers (or re-registers,
 * picking up a changed gateway base URL) when dedicated is enabled, and
 * unregisters when it is disabled or the gateway URL is unset.
 */
export function reconcileDedicatedProvider(
  pi: Pick<ExtensionAPI, "registerProvider" | "unregisterProvider">,
  getModels: GetRegistryModels,
): void {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled || !resolveProviderBaseUrl(config)) {
    pi.unregisterProvider(PROVIDER_NAME);
    return;
  }
  registerDedicatedProvider(pi, getModels);
}
