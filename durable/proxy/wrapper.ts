import type {
  AnyModel,
  Api,
  DeferredHandle,
  Model,
  Provider,
} from "@earendil-works/pi-ai";
import { getModelType, isModelType } from "@earendil-works/pi-ai";
import { getBaseUrlForApi } from "../base-url-routing";
import { buildStream, buildStreamSimple } from "../provider/api-routing";
import { qualifyModelId, withModelId, withRequestModelId } from "./model-id";
import { OPENAI_BASE_URL, withOpenAIGatewayFetch } from "./openai-passthrough";

export interface ProxyWrapperOptions {
  gatewayId: string;
  gatewayRoot: string;
  baseUrl: string;
  upstreamBaseUrl?: string;
  apiOverride?: Api;
  passthrough: boolean;
  servedIds?: ReadonlySet<string>;
}

function requestHandle(
  handle: DeferredHandle,
  model: Model<Api>,
  publicId: string,
): DeferredHandle {
  if (handle.provider !== model.provider)
    throw new Error("Deferred response belongs to another provider");
  if (handle.modelId !== publicId && handle.modelId !== model.id)
    throw new Error("Deferred response belongs to another model");
  if (handle.api !== model.api)
    throw new Error("Aperture cannot change the API of a deferred response");
  return { ...handle, modelId: model.id };
}

export function wrapProxyProvider(
  native: Provider,
  routing: ProxyWrapperOptions,
): Provider {
  const nativeModels = () => native.getAllModels?.() ?? native.getModels();
  const routedModel = <T extends AnyModel>(model: T): T => {
    const chat = isModelType(model, "chat");
    const api = chat ? (routing.apiOverride ?? model.api) : model.api;
    const original = nativeModels().find(
      (m) => m.id === model.id && getModelType(m) === getModelType(model),
    );
    const upstream = original?.baseUrl ?? routing.upstreamBaseUrl;
    const subscription =
      routing.passthrough &&
      api === "openai-responses" &&
      upstream === OPENAI_BASE_URL;
    return {
      ...model,
      api,
      baseUrl: subscription
        ? OPENAI_BASE_URL
        : getBaseUrlForApi(api, routing.gatewayRoot, routing.baseUrl, upstream),
    };
  };
  const requestModel = <T extends AnyModel>(model: T): T =>
    qualifyModelId(routing.gatewayId, routedModel(model));
  const requestOptions = <T extends { fetch?: typeof fetch }>(
    model: AnyModel,
    options: T | undefined,
  ): T | undefined => {
    const routed = routedModel(model);
    const subscription =
      routed.api === "openai-responses" && routed.baseUrl === OPENAI_BASE_URL;
    return withOpenAIGatewayFetch(
      options,
      subscription ? routing.gatewayRoot : undefined,
    );
  };
  const served = <T extends AnyModel>(models: readonly T[]): readonly T[] =>
    models
      .filter((model) => !routing.servedIds || routing.servedIds.has(model.id))
      .map(routedModel);
  const deferredHandle = (
    handle: DeferredHandle,
    model: Model<Api>,
    publicId: string,
  ) => {
    if (!native.getModels().some((m) => m.api === model.api)) {
      throw new Error(
        "Aperture API override cannot use native deferred operations",
      );
    }
    return requestHandle(handle, model, publicId);
  };

  const baseAuth = native.auth?.apiKey;
  const wrapped: Provider = {
    ...native,
    id: native.id,
    name: native.name,
    refreshModels: native.refreshModels?.bind(native),
    filterModels: native.filterModels?.bind(native),
    filterAllModels: native.filterAllModels?.bind(native),
    fetchDeferred: undefined,
    cancelDeferred: undefined,
    generateImages: undefined,
    classify: undefined,
    getModels: () => served(native.getModels()),
    getAllModels: () => served(nativeModels()),
    auth: routing.passthrough
      ? native.auth
      : {
          ...native.auth,
          apiKey: {
            ...baseAuth,
            name: baseAuth?.name ?? "Aperture",
            check: async () => ({ type: "api_key", source: "aperture proxy" }),
            resolve: async () => ({
              auth: { apiKey: "-" },
              source: "aperture proxy",
            }),
          },
        },
    stream: (model, context, options) => {
      const request = requestModel(model);
      const stream = routing.apiOverride
        ? buildStream()
        : native.stream.bind(native);
      return withModelId(
        stream(
          request,
          withRequestModelId(context, model, request),
          requestOptions(model, options),
        ),
        model.id,
      );
    },
    streamSimple: (model, context, options) => {
      const request = requestModel(model);
      const stream = routing.apiOverride
        ? buildStreamSimple()
        : native.streamSimple.bind(native);
      return withModelId(
        stream(
          request,
          withRequestModelId(context, model, request),
          requestOptions(model, options),
        ),
        model.id,
      );
    },
  };
  // These operations keep their native implementation and operation-specific API.
  const fetchDeferred = native.fetchDeferred?.bind(native);
  if (fetchDeferred) {
    wrapped.fetchDeferred = (model, handle, options) => {
      const request = requestModel(model);
      const stream = fetchDeferred(
        request,
        deferredHandle(handle, request, model.id),
        requestOptions(model, options),
      );
      return withModelId(stream, model.id);
    };
  }
  const cancelDeferred = native.cancelDeferred?.bind(native);
  if (cancelDeferred) {
    wrapped.cancelDeferred = (model, handle, options) => {
      const request = requestModel(model);
      return cancelDeferred(
        request,
        deferredHandle(handle, request, model.id),
        requestOptions(model, options),
      );
    };
  }
  const generateImages = native.generateImages?.bind(native);
  if (generateImages) {
    wrapped.generateImages = async (model, context, options) => {
      const result = await generateImages(
        requestModel(model),
        context,
        requestOptions(model, options),
      );
      return { ...result, model: model.id };
    };
  }
  const classify = native.classify?.bind(native);
  if (classify) {
    wrapped.classify = async (model, context, options) => {
      const result = await classify(
        requestModel(model),
        context,
        requestOptions(model, options),
      );
      return { ...result, model: model.id };
    };
  }
  return wrapped;
}
