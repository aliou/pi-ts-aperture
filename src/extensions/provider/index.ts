import type { Api, Model } from "@mariozechner/pi-ai";
import { getApiProvider } from "@mariozechner/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../../lib/config";
import { fetchGatewayModels, type GatewayModel } from "../../lib/gateway";
import { buildDefaultModelConfig } from "../../lib/model-defaults";
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

function getApertureModelId(model: GatewayModel): string {
  return model.provider ? `${model.provider.id}/${model.id}` : model.id;
}

function getRequestModelId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
}

function getProviderId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  return slashIndex === -1 ? "" : modelId.slice(0, slashIndex);
}

function buildProviderModelConfig(model: GatewayModel): ProviderModelConfig {
  return buildDefaultModelConfig(getApertureModelId(model));
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

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const config = configLoader.getConfig();
  const gatewayUrl = resolveGatewayUrl(config);
  const baseUrl = resolveProviderBaseUrl(config);

  if (config.mode !== "dedicated" || !gatewayUrl || !baseUrl) return;

  const gatewayModels = await fetchGatewayModels(gatewayUrl);

  // Filter models by enabled dedicated providers
  const enabledProviderIds = new Set(
    config.dedicated.providers.filter((p) => p.enabled).map((p) => p.id),
  );
  const filteredModels =
    enabledProviderIds.size > 0
      ? gatewayModels.filter((m) => enabledProviderIds.has(m.providerId))
      : gatewayModels; // No config saved yet -> include all

  const models: ProviderModelConfig[] = filteredModels.map(
    buildProviderModelConfig,
  );

  pi.registerProvider(PROVIDER_NAME, {
    baseUrl,
    apiKey: "-",
    api: "openai-completions",
    headers: HEADERS,
    models,
    streamSimple: buildStreamSimple(),
  });
}
