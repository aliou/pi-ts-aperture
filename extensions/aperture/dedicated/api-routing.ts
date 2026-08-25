import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "../../shared/types";

function providerFor(model: Model<Api>) {
  const provider = getApiProvider(model.api);
  if (!provider) {
    throw new Error(`Unsupported Aperture provider API: ${model.api}`);
  }
  return provider;
}

/** Stream by dispatching to the upstream Pi API the model routes through. */
export function buildStreamSimple() {
  return (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    providerFor(model).streamSimple(model, context, options);
}

/** Full-stream counterpart of buildStreamSimple. */
export function buildStream() {
  return (
    model: Model<Api>,
    context: Context,
    options?: StreamOptions,
  ): AssistantMessageEventStream =>
    providerFor(model).stream(model, context, options);
}
