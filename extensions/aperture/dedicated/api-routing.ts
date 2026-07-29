import type { Api, Model } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ProviderCompatibility } from "../../../src/api/types";
import { shouldUseGatewayRoot } from "../../../src/base-url-routing";
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
  upstreamBaseUrl?: string,
): string {
  switch (api) {
    case "anthropic-messages":
      return gatewayUrl;
    case "google-generative-ai":
      return `${gatewayUrl}/v1beta`;
    case "google-vertex":
      return `${gatewayUrl}/v1`;
    default:
      // openai-completions / openai-responses: infer from the upstream base
      // URL (when known) whether the gateway root or gateway/v1 is correct.
      // Providers whose upstream does not end in /v1 (e.g. Z.ai
      // /api/coding/paas/v4) need the root; others keep gateway/v1. Missing
      // upstream URLs keep /v1 to stay safe.
      return shouldUseGatewayRoot(api, upstreamBaseUrl) ? gatewayUrl : baseUrl;
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
