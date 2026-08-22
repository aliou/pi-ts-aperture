import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type { ProviderCompatibility } from "../../../src/api/types";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "../../shared/types";

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

/** A legacy store entry, stamped before models carried their real Pi API. */
type LegacyRoutedModel = Model<Api> & { upstreamApi?: Api };

/**
 * Pi API the model's requests route through. Models built by the current
 * catalog carry their real API on `model.api`; snapshots persisted by older
 * versions stamped the custom `"aperture"` marker and kept the real API on a
 * side field.
 */
function upstreamApi(model: Model<Api>): Api {
  if (model.api === "aperture") {
    return (model as LegacyRoutedModel).upstreamApi ?? "openai-completions";
  }
  return model.api;
}

/** Stream by dispatching to the upstream Pi API the model routes through. */
export function buildStreamSimple() {
  return (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    const api = upstreamApi(model);
    const provider = getApiProvider(api);
    if (!provider) {
      throw new Error(`Unsupported Aperture provider API: ${api}`);
    }

    return provider.streamSimple({ ...model, api }, context, options);
  };
}

/** Full-stream counterpart of buildStreamSimple. */
export function buildStream() {
  return (
    model: Model<Api>,
    context: Context,
    options?: StreamOptions,
  ): AssistantMessageEventStream => {
    const api = upstreamApi(model);
    const provider = getApiProvider(api);
    if (!provider) {
      throw new Error(`Unsupported Aperture provider API: ${api}`);
    }

    return provider.stream({ ...model, api }, context, options);
  };
}
