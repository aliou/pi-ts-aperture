import type {
  Api,
  AssistantMessageEventStream,
  Model,
  ProviderStreams,
  SimpleStreamOptions,
  StreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { embedsModelIdInPath } from "./base-url-routing";

export type ApiUpstreams = (api: Api) => ProviderStreams | undefined;

function upstreamFor(upstreams: ApiUpstreams, model: Model<Api>) {
  const upstream = upstreams(model.api);
  if (!upstream) {
    throw new Error(`Unsupported Aperture provider API: ${model.api}`);
  }
  return upstream;
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

/** Stream by dispatching to the upstream Pi API the model routes through. */
export function buildStreamSimple(upstreams: ApiUpstreams) {
  return (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    upstreamFor(upstreams, model).streamSimple(
      requestModel(model),
      context,
      options,
    );
}

/** Full-stream counterpart of buildStreamSimple. */
export function buildStream(upstreams: ApiUpstreams) {
  return (
    model: Model<Api>,
    context: TranscriptContext,
    options?: StreamOptions,
  ): AssistantMessageEventStream =>
    upstreamFor(upstreams, model).stream(requestModel(model), context, options);
}
