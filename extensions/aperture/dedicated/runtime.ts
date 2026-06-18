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

const PROVIDER_NAME = "aperture";
const APERTURE_API = "aperture";

const HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

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

export class DedicatedRuntime {
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

    if (models.length === 0) return;

    pi.registerProvider(PROVIDER_NAME, {
      baseUrl,
      apiKey: "-",
      api: APERTURE_API,
      headers: HEADERS,
      models,
      streamSimple: buildStreamSimple(routeByModelId),
    });
  }
}
