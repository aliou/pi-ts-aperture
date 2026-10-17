import type {
  AnyModel,
  Api,
  KnownApi,
  Model,
  Provider,
} from "@earendil-works/pi-ai";
import { isModelType } from "@earendil-works/pi-ai";
import { buildStream, buildStreamSimple } from "./provider/api-routing";
import { refreshApertureCatalog } from "./provider/catalog";
import {
  APERTURE_SYSTEM_ONE_API,
  classify as classifySystemOne,
} from "./provider/system-one";
import { resolveProviderBaseUrl } from "./url";

export type ApertureApi = Extract<
  KnownApi,
  | "openai-completions"
  | "anthropic-messages"
  | "openai-responses"
  | "google-generative-ai"
  | "google-vertex"
  | "bedrock-converse-stream"
>;

export interface ApertureProviderFilter {
  id: string;
  enabled: boolean;
  api?: ApertureApi;
}

export interface ApertureProviderOptions {
  /** Gateway URL, with or without /v1. */
  baseUrl: string;
  /** Empty or omitted includes all gateway-managed providers. */
  providers?: readonly ApertureProviderFilter[];
  /** Native models for metadata and upstream URL inference; defaults to none. */
  getRegistryModels?: () => readonly Model<Api>[];
  onWarning?: (warning: string) => void;
}

export function createApertureProvider(
  options: ApertureProviderOptions,
): Provider {
  const baseUrl = resolveProviderBaseUrl(options);
  if (!baseUrl) throw new Error("Aperture baseUrl is required");
  let liveModels: AnyModel[] = [];

  return {
    id: "aperture",
    name: "Aperture",
    baseUrl,
    auth: {
      apiKey: {
        name: "Aperture",
        check: async () => ({ type: "api_key", source: "aperture gateway" }),
        resolve: async () => ({
          auth: { apiKey: "-" },
          source: "aperture gateway",
        }),
      },
    },
    // `getModels` is the chat catalog Pi lists and requests through;
    // `getAllModels` additionally exposes classifier models.
    getModels: () =>
      liveModels.filter(
        (model): model is Model<Api> => !isModelType(model, "classifier"),
      ),
    getAllModels: () => liveModels,
    classify: (model, context, options) => {
      if (model.api !== APERTURE_SYSTEM_ONE_API) {
        throw new Error(
          `Aperture provider has no classifier implementation for "${model.api}"`,
        );
      }
      return classifySystemOne(model, context, options);
    },
    refreshModels: async (context) => {
      const catalog = await refreshApertureCatalog(context, options);
      await context.publish({
        update: () => {
          liveModels = catalog;
        },
      });
    },
    stream: buildStream(),
    streamSimple: buildStreamSimple(),
  };
}
