import type { Api, Model } from "@mariozechner/pi-ai";
import { getApiProvider } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import type { CachedModel } from "../../lib/config";
import { configLoader } from "../../lib/config";
import { fetchGatewayModels, type GatewayModel } from "../../lib/gateway";
import {
  buildCachedModelConfig,
  buildDefaultModelConfig,
  PROVIDER_SEPARATOR,
  toCachedModel,
} from "../../lib/model-defaults";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "../../lib/types";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../lib/url";

const PROVIDER_NAME = "aperture";

const HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

function getRequestModelId(modelId: string): string {
  const sepIndex = modelId.indexOf(PROVIDER_SEPARATOR);
  return sepIndex === -1
    ? modelId
    : modelId.slice(sepIndex + PROVIDER_SEPARATOR.length);
}

function getProviderId(modelId: string): string {
  const sepIndex = modelId.indexOf(PROVIDER_SEPARATOR);
  return sepIndex === -1 ? "" : modelId.slice(0, sepIndex);
}

function buildStreamSimple() {
  const builtIn = getApiProvider("openai-completions");
  if (!builtIn) return undefined;

  return (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    builtIn.streamSimple(
      { ...model, id: getRequestModelId(model.id) },
      context,
      {
        ...options,
        headers: {
          ...options?.headers,
          "x-session-id": options?.sessionId ?? "",
          "x-upstream-provider-id": getProviderId(model.id),
        },
      },
    );
}

/** Filter cached models by enabled dedicated providers. */
function filterCachedModels(
  cached: CachedModel[],
  enabledProviderIds: Set<string>,
): CachedModel[] {
  return enabledProviderIds.size > 0
    ? cached.filter((m) => enabledProviderIds.has(m.providerId))
    : cached;
}

/** Filter gateway models by enabled dedicated providers. */
function filterGatewayModels(
  models: GatewayModel[],
  enabledProviderIds: Set<string>,
): GatewayModel[] {
  return enabledProviderIds.size > 0
    ? models.filter((m) => enabledProviderIds.has(m.providerId))
    : models;
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const config = configLoader.getConfig();
  const gatewayUrl = resolveGatewayUrl(config);
  const baseUrl = resolveProviderBaseUrl(config);

  if (config.mode !== "dedicated" || !gatewayUrl || !baseUrl) return;

  const streamSimple = buildStreamSimple();

  const enabledProviderIds = new Set(
    config.dedicated.providers.filter((p) => p.enabled).map((p) => p.id),
  );

  // --- Register cached models immediately (no network) ---
  const cached = filterCachedModels(
    config.dedicated.cachedModels,
    enabledProviderIds,
  );
  const cachedModelConfigs: ProviderModelConfig[] = cached.map(
    buildCachedModelConfig,
  );

  if (cachedModelConfigs.length > 0) {
    pi.registerProvider(PROVIDER_NAME, {
      baseUrl,
      apiKey: "-",
      api: "openai-completions",
      headers: HEADERS,
      models: cachedModelConfigs,
      streamSimple,
    });
  }

  // --- Fetch fresh models in background, re-register if changed ---
  const gatewayModels = await fetchGatewayModels(gatewayUrl);
  const filteredModels = filterGatewayModels(gatewayModels, enabledProviderIds);
  const freshModelConfigs: ProviderModelConfig[] = filteredModels.map(
    buildDefaultModelConfig,
  );

  // Check if model list changed
  const cachedIds = new Set(cachedModelConfigs.map((m) => m.id));
  const freshIds = new Set(freshModelConfigs.map((m) => m.id));
  const changed =
    cachedIds.size !== freshIds.size ||
    [...freshIds].some((id) => !cachedIds.has(id));

  // Always re-register with fresh data (prices may have changed)
  if (freshModelConfigs.length > 0) {
    pi.registerProvider(PROVIDER_NAME, {
      baseUrl,
      apiKey: "-",
      api: "openai-completions",
      headers: HEADERS,
      models: freshModelConfigs,
      streamSimple,
    });
  }

  // Persist cache if models changed
  if (changed) {
    const allCached = gatewayModels.map(toCachedModel);
    await configLoader.save("global", {
      ...configLoader.getRawConfig("global"),
      dedicated: {
        ...configLoader.getRawConfig("global")?.dedicated,
        providers: config.dedicated.providers,
        cachedModels: allCached,
      },
    });
  }
}
