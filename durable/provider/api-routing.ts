import type {
  Api,
  AssistantMessageEventStream,
  Model,
  SimpleStreamOptions,
  StreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { embedsModelIdInPath } from "../base-url-routing";

function providerFor(model: Model<Api>) {
  const provider = getApiProvider(model.api);
  if (!provider) {
    throw new Error(`Unsupported Aperture provider API: ${model.api}`);
  }
  return provider;
}

function requestModel(model: Model<Api>): Model<Api> {
  if (!embedsModelIdInPath(model.api)) return model;
  const slash = model.id.indexOf("/");
  if (slash === -1) return model;
  return { ...model, id: model.id.slice(slash + 1) };
}

export function buildStreamSimple() {
  return (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    providerFor(model).streamSimple(requestModel(model), context, options);
}

export function buildStream() {
  return (
    model: Model<Api>,
    context: TranscriptContext,
    options?: StreamOptions,
  ): AssistantMessageEventStream =>
    providerFor(model).stream(requestModel(model), context, options);
}
