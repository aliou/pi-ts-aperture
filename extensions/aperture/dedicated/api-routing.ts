import type { Api, Model } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ProviderCompatibility } from "../../../src/api/types";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "../../../src/shared/types";

interface ModelRoute {
  api: Api;
}

export function getApiForCompatibility(
  compatibility: ProviderCompatibility | undefined,
): Api {
  // Prefer chat completions when available: it is Aperture's default and the
  // broadest compatibility mode for Pi's tool-calling path.
  if (!compatibility || compatibility.openai_chat) return "openai-completions";
  if (compatibility.anthropic_messages) return "anthropic-messages";
  if (compatibility.openai_responses) return "openai-responses";
  if (compatibility.gemini_generate_content) return "google-generative-ai";
  if (compatibility.google_generate_content) return "google-vertex";
  if (compatibility.bedrock_converse) return "bedrock-converse-stream";
  return "openai-completions";
}

export function getBaseUrlForApi(
  api: Api,
  gatewayUrl: string,
  baseUrl: string,
): string {
  switch (api) {
    case "anthropic-messages":
      return gatewayUrl;
    case "google-generative-ai":
      return `${gatewayUrl}/v1beta`;
    case "google-vertex":
      return `${gatewayUrl}/v1`;
    default:
      return baseUrl;
  }
}

export function buildStreamSimple(routeByModelId: Map<string, ModelRoute>) {
  return (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const route = routeByModelId.get(model.id);
    const api = route?.api ?? "openai-completions";
    const provider = getApiProvider(api);
    if (!provider) {
      throw new Error(`Unsupported Aperture provider API: ${api}`);
    }

    return provider.streamSimple({ ...model, api }, context, options);
  };
}
