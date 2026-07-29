import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
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
import {
  type DedicatedModelsCache,
  loadCachedDedicatedModels,
  writeCachedDedicatedModels,
} from "./models-cache";

const PROVIDER_NAME = "aperture";
const APERTURE_API = "aperture";

/**
 * Optional dependencies for dedicated sync. `getModels` exposes Pi's native
 * model registry so upstream base URLs can be looked up per provider/model
 * and used to infer gateway root vs gateway/v1 (see `getBaseUrlForApi`).
 */
export interface DedicatedSyncDeps {
  getModels?: () => Model<Api>[];
}

interface BuiltModels {
  models: ProviderModelConfig[];
  routeByModelId: Map<string, { api: Api }>;
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
): BuiltModels {
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

  const routeByModelId = new Map<string, { api: Api }>();
  const models: ProviderModelConfig[] = [];

  for (const provider of providers) {
    const api = getApiForCompatibility(provider.compatibility);
    const providerUpstream = upstreamByProvider.get(provider.id);
    for (const modelId of provider.models) {
      routeByModelId.set(modelId, { api });
      const modelInfo = provider.modelInfoById?.[modelId];
      // Fall back to a model-id lookup when the provider id does not match a
      // native Pi provider (e.g. a custom Aperture provider name).
      const upstreamBaseUrl = providerUpstream ?? upstreamByModel.get(modelId);
      models.push({
        ...buildDefaultModelConfig({
          id: modelId,
          providerId: provider.id,
          provider: { id: provider.id, name: provider.name },
          pricing: modelInfo?.pricing,
        }),
        api: APERTURE_API,
        baseUrl: getBaseUrlForApi(api, gatewayUrl, baseUrl, upstreamBaseUrl),
      });
    }
  }

  return { models, routeByModelId };
}

function registerFromBuilt(
  pi: Pick<ExtensionAPI, "registerProvider">,
  baseUrl: string,
  built: BuiltModels,
): void {
  if (built.models.length === 0) return;
  pi.registerProvider(PROVIDER_NAME, {
    baseUrl,
    apiKey: "-",
    api: APERTURE_API,
    models: built.models,
    streamSimple: buildStreamSimple(built.routeByModelId),
  });
}

export class DedicatedRuntime {
  /**
   * Register the aperture provider synchronously from the on-disk cache so Pi
   * can validate scoped models during startup, before `session_start`
   * revalidates from the live gateway.
   *
   * No-ops when dedicated is disabled, the gateway URL is unset, or there is
   * no usable cache (first run, or cache for a different gateway URL). The
   * subsequent revalidation in {@link syncConfig} writes a fresh cache.
   */
  registerCached(pi: Pick<ExtensionAPI, "registerProvider">): void {
    const config = configLoader.getConfig();
    if (!config.dedicated.enabled) return;

    const gatewayUrl = resolveGatewayUrl(config);
    const baseUrl = resolveProviderBaseUrl(config);
    if (!gatewayUrl || !baseUrl) return;

    const cache = loadCachedDedicatedModels(gatewayUrl);
    if (!cache) return;

    const routeByModelId = new Map<string, { api: Api }>();
    for (const [modelId, api] of Object.entries(cache.routes)) {
      routeByModelId.set(modelId, { api });
    }

    registerFromBuilt(pi, baseUrl, {
      models: cache.models,
      routeByModelId,
    });
  }

  async sync(
    pi: Pick<ExtensionAPI, "registerProvider">,
    deps?: DedicatedSyncDeps,
  ): Promise<void> {
    const config = configLoader.getConfig();
    await this.syncConfig(pi, config, deps);
  }

  async syncConfig(
    pi: Pick<ExtensionAPI, "registerProvider">,
    config: ResolvedConfig,
    deps?: DedicatedSyncDeps,
  ): Promise<void> {
    if (!config.dedicated.enabled) return;

    const gatewayUrl = resolveGatewayUrl(config);
    const baseUrl = resolveProviderBaseUrl(config);
    if (!gatewayUrl || !baseUrl) return;

    const gatewayProviders = await new ApertureClient(gatewayUrl).providers();
    const providers = filterProviders(gatewayProviders, config);
    const registryModels = deps?.getModels?.() ?? [];
    const built = buildModels(providers, gatewayUrl, baseUrl, registryModels);

    registerFromBuilt(pi, baseUrl, built);

    if (built.models.length > 0) {
      const routes = new Map<string, Api>();
      for (const [modelId, route] of built.routeByModelId) {
        routes.set(modelId, route.api);
      }
      await writeCachedDedicatedModels(gatewayUrl, built.models, routes);
    }
  }
}

export type { DedicatedModelsCache };
