import { getApiProvider } from "@mariozechner/pi-ai";
import type {
  ProviderConfig,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { fetchGatewayModels, type GatewayModel } from "../../lib/gateway";
import { buildDefaultModelConfig } from "../../lib/model-defaults";
import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "../../lib/types";

const PROVIDER_NAME = "aperture";

const HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

interface ProviderSyncDeps {
  registerProvider: (name: string, config: ProviderConfig) => void;
  getModels: () => Model<Api>[];
  gatewayUrl: string;
  baseUrl: string;
}

function getApertureModelId(model: GatewayModel): string {
  return model.provider ? `${model.provider.id}/${model.id}` : model.id;
}

function copyModelConfig(
  model: Model<Api>,
  gatewayModel: GatewayModel,
): ProviderModelConfig {
  return {
    id: getApertureModelId(gatewayModel),
    name: model.name,
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  };
}

export class ApertureProviderRuntime {
  private registered = false;
  private requestModelIds = new Map<string, string>();
  private upstreamProviders = new Map<
    string,
    { id: string; name?: string } | undefined
  >();

  async sync(deps: ProviderSyncDeps): Promise<void> {
    const gatewayModels = await fetchGatewayModels(deps.gatewayUrl);
    if (gatewayModels.length === 0) return;

    const registryModels = deps
      .getModels()
      .filter((m) => m.provider !== PROVIDER_NAME);
    const requestModelIds = new Map<string, string>();
    const upstreamProviders = new Map<
      string,
      { id: string; name?: string } | undefined
    >();
    const models = gatewayModels.map((gatewayModel) => {
      const apertureModelId = getApertureModelId(gatewayModel);
      requestModelIds.set(apertureModelId, gatewayModel.id);
      upstreamProviders.set(apertureModelId, gatewayModel.provider);

      const match =
        registryModels.find(
          (m) =>
            m.id === gatewayModel.id &&
            m.provider === gatewayModel.provider?.id,
        ) ?? registryModels.find((m) => m.id === gatewayModel.id);
      return match
        ? copyModelConfig(match, gatewayModel)
        : buildDefaultModelConfig(apertureModelId);
    });
    this.requestModelIds = requestModelIds;
    this.upstreamProviders = upstreamProviders;

    const builtIn = getApiProvider("openai-completions");

    deps.registerProvider(PROVIDER_NAME, {
      baseUrl: deps.baseUrl,
      apiKey: "-",
      api: "openai-completions",
      headers: HEADERS,
      models,
      streamSimple: builtIn
        ? (
            model: Model<Api>,
            context: Context,
            options?: SimpleStreamOptions,
          ): AssistantMessageEventStream =>
            builtIn.streamSimple(
              { ...model, id: this.requestModelIds.get(model.id) ?? model.id },
              context,
              {
                ...options,
                headers: {
                  ...options?.headers,
                  "x-session-id": options?.sessionId ?? "",
                  "x-upstream-provider-id":
                    this.upstreamProviders.get(model.id)?.id ?? "",
                  "x-upstream-provider-name":
                    this.upstreamProviders.get(model.id)?.name ?? "",
                },
              },
            )
        : undefined,
    });

    this.registered = true;
  }

  unregister(pi: { unregisterProvider: (name: string) => void }): void {
    if (!this.registered) return;
    pi.unregisterProvider(PROVIDER_NAME);
    this.registered = false;
  }
}
