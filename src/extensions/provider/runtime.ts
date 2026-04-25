import { getApiProvider } from "@mariozechner/pi-ai";
import type {
  ProviderConfig,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { fetchGatewayModelIds } from "../../lib/gateway";
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

function copyModelConfig(model: Model<Api>): ProviderModelConfig {
  return {
    id: model.id,
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

  async sync(deps: ProviderSyncDeps): Promise<void> {
    const gatewayModelIds = await fetchGatewayModelIds(deps.gatewayUrl);
    if (gatewayModelIds.length === 0) return;

    const registryModels = deps
      .getModels()
      .filter((m) => m.provider !== PROVIDER_NAME);
    const models = gatewayModelIds.map((id) => {
      const match = registryModels.find((m) => m.id === id);
      return match ? copyModelConfig(match) : buildDefaultModelConfig(id);
    });

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
            builtIn.streamSimple(model, context, {
              ...options,
              headers: {
                ...options?.headers,
                "x-session-id": options?.sessionId ?? "",
              },
            })
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
