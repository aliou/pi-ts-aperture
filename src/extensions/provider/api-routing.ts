import type { Api, Model } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai";
import type { GatewayProviderCompatibility } from "../../lib/gateway";
import { PROVIDER_SEPARATOR } from "../../lib/model-defaults";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "../../lib/types";

export function getRequestModelId(modelId: string): string {
  const sepIndex = modelId.indexOf(PROVIDER_SEPARATOR);
  return sepIndex === -1
    ? modelId
    : modelId.slice(sepIndex + PROVIDER_SEPARATOR.length);
}

export function getProviderId(modelId: string): string {
  const sepIndex = modelId.indexOf(PROVIDER_SEPARATOR);
  return sepIndex === -1 ? "" : modelId.slice(0, sepIndex);
}

export function getApiForCompatibility(
  compatibility: GatewayProviderCompatibility | undefined,
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

export function buildStreamSimple(targetApiByProviderId: Map<string, Api>) {
  return (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const providerId = getProviderId(model.id);
    const api = targetApiByProviderId.get(providerId) ?? "openai-completions";
    const provider = getApiProvider(api);
    if (!provider) {
      throw new Error(`Unsupported Aperture provider API: ${api}`);
    }

    return provider.streamSimple(
      { ...model, api, id: getRequestModelId(model.id) },
      context,
      {
        ...options,
        headers: {
          ...options?.headers,
          "x-session-id": options?.sessionId ?? "",
          "x-upstream-provider-id": providerId,
        },
      },
    );
  };
}
