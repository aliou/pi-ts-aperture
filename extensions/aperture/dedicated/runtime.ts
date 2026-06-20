import type { Api } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../../src/url";
import { configLoader, type ResolvedConfig } from "../shared/config/loader";
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

const HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

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
): BuiltModels {
  const routeByModelId = new Map<string, { api: Api }>();
  const models: ProviderModelConfig[] = [];

  for (const provider of providers) {
    const api = getApiForCompatibility(provider.compatibility);
    for (const modelId of provider.models) {
      routeByModelId.set(modelId, { api });
      models.push({
        ...buildDefaultModelConfig({
          id: modelId,
          providerId: provider.id,
          provider: { id: provider.id, name: provider.name },
        }),
        api: APERTURE_API,
        baseUrl: getBaseUrlForApi(api, gatewayUrl, baseUrl),
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
    headers: HEADERS,
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

  async sync(pi: Pick<ExtensionAPI, "registerProvider">): Promise<void> {
    const config = configLoader.getConfig();
    await this.syncConfig(pi, config);
  }

  async syncConfig(
    pi: Pick<ExtensionAPI, "registerProvider">,
    config: ResolvedConfig,
  ): Promise<void> {
    if (!config.dedicated.enabled) return;

    const gatewayUrl = resolveGatewayUrl(config);
    const baseUrl = resolveProviderBaseUrl(config);
    if (!gatewayUrl || !baseUrl) return;

    const providers = filterProviders(
      await new ApertureClient(gatewayUrl).providers(),
      config,
    );
    const built = buildModels(providers, gatewayUrl, baseUrl);

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
