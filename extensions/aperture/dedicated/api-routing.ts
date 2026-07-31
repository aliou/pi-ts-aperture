import type { Api, Model } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ProviderCompatibility } from "../../../src/api/types";
import { shouldUseGatewayRoot } from "../../../src/base-url-routing";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "../../../src/shared/types";

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
    // Aperture's native Bedrock-compatible surface lives at /bedrock, not
    // /v1. The default branch below would otherwise point bedrock_converse
    // models at the generic OpenAI-shaped base URL and fail with a
    // protocol error.
    case "bedrock-converse-stream":
      return `${gatewayUrl}/bedrock`;
    default:
      // openai-completions / openai-responses: infer from the upstream base
      // URL (when known) whether the gateway root or gateway/v1 is correct.
      // Providers whose upstream does not end in /v1 (e.g. Z.ai
      // /api/coding/paas/v4) need the root; others keep gateway/v1. Missing
      // upstream URLs keep /v1 to stay safe.
      return shouldUseGatewayRoot(api, upstreamBaseUrl) ? gatewayUrl : baseUrl;
  }
}

/**
 * A dedicated model as seen at stream time. `upstreamApi` is stamped on each
 * model config by `buildModels` (runtime.ts) so the request can be routed to
 * the correct upstream Pi API; `model.api` itself is the custom `"aperture"`
 * marker. Pi types the model handed to `streamSimple` as `Model<Api>`, but
 * its provider composition spreads our full model definition (verified
 * against provider-composer.ts in pi 0.83.0), so the extra field survives
 * registration, the models store, and cache-only restores. The cast below
 * only recovers that field.
 */
type ApertureRoutedModel = Model<Api> & { upstreamApi?: Api };

/**
 * Stream by dispatching to the upstream Pi API stamped on the model.
 * A missing field falls back to openai-completions, matching the old
 * missing-route behavior.
 */
export function buildStreamSimple() {
  return (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const api =
      (model as ApertureRoutedModel).upstreamApi ?? "openai-completions";
    const provider = getApiProvider(api);
    if (!provider) {
      throw new Error(`Unsupported Aperture provider API: ${api}`);
    }

    return provider.streamSimple({ ...model, api }, context, options);
  };
}
