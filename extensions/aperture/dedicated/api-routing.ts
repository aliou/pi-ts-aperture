import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ProviderCompatibility } from "../../../src/api/types";
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

/**
 * A dedicated model as seen at stream time. `upstreamApi` is stamped on each
 * model config by `buildModels` (runtime.ts) so the request can be routed to
 * the correct upstream Pi API; `model.api` itself is the custom `"aperture"`
 * marker. Pi types the model handed to `streamSimple` as `Model<Api>`, but
 * its provider composition spreads our full model definition (verified
 * against pi's provider-composer), so the extra field survives
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

/**
 * Full-stream counterpart of buildStreamSimple: the composer previously
 * routed `provider.stream()` through the config form's streamSimple because
 * the custom `aperture` API marker matched; a native Provider must implement
 * `stream` itself.
 */
export function buildStream() {
  return (
    model: Model<Api>,
    context: Context,
    options?: StreamOptions,
  ): AssistantMessageEventStream => {
    const api =
      (model as ApertureRoutedModel).upstreamApi ?? "openai-completions";
    const provider = getApiProvider(api);
    if (!provider) {
      throw new Error(`Unsupported Aperture provider API: ${api}`);
    }

    return provider.stream({ ...model, api }, context, options);
  };
}
