import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { embedsModelIdInPath } from "../../src/base-url-routing";
import type {
  AssistantMessageEventStream,
  SimpleStreamOptions,
  TranscriptContext,
} from "./types";

function providerFor(model: Model<Api>) {
  const provider = getApiProvider(model.api);
  if (!provider) {
    throw new Error(`Unsupported Aperture provider API: ${model.api}`);
  }
  return provider;
}

/**
 * Strip the `provider/` catalog prefix for path-embedding APIs. The gateway
 * forwards Gemini/Vertex/Bedrock URL paths verbatim upstream, so the
 * qualified id the model picker shows would 404; the bare id still routes
 * because the gateway resolves it provider-side. Only the first path segment
 * is stripped: upstream ids may themselves contain slashes
 * (e.g. `acme/hf:org/some-model`).
 */
function requestModel(model: Model<Api>): Model<Api> {
  if (!embedsModelIdInPath(model.api)) return model;
  const slash = model.id.indexOf("/");
  if (slash === -1) return model;
  return { ...model, id: model.id.slice(slash + 1) };
}

type WrapOptions<TOptions> = (
  model: Model<Api>,
  options: TOptions | undefined,
) => TOptions | undefined;

/**
 * Stream by dispatching to the upstream Pi API the model routes through.
 * `wrapOptions` (dedicated-only, e.g. reasoning replay) sees the catalog
 * model before any path-embedding id rewrite.
 */
export function buildStreamSimple(
  wrapOptions?: WrapOptions<SimpleStreamOptions>,
) {
  return (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    providerFor(model).streamSimple(
      requestModel(model),
      context,
      wrapOptions ? wrapOptions(model, options) : options,
    );
}

/** Full-stream counterpart of buildStreamSimple. */
export function buildStream(wrapOptions?: WrapOptions<StreamOptions>) {
  return (
    model: Model<Api>,
    context: TranscriptContext,
    options?: StreamOptions,
  ): AssistantMessageEventStream =>
    providerFor(model).stream(
      requestModel(model),
      context,
      wrapOptions ? wrapOptions(model, options) : options,
    );
}
