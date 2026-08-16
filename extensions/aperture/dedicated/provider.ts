import type {
  Api,
  Model,
  Provider,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { buildStream, buildStreamSimple } from "./api-routing";

export const DEDICATED_PROVIDER_ID = "aperture";

/**
 * Fetch/build the dedicated catalog. Returns the models to adopt, or
 * undefined when nothing should change (network refresh failures propagate so
 * Pi reports them; cache-only restore returns [] for an unusable snapshot).
 */
export type RefreshDedicatedCatalog = (
  context: RefreshModelsContext,
) => Promise<Model<Api>[] | undefined>;

/**
 * Assemble the dedicated `aperture` provider as a native pi-ai Provider.
 *
 * Native registration (`pi.registerProvider(provider)`) replaces the former
 * name-plus-config form: the Provider owns its auth (gateway-authenticated,
 * resolve never throws and returns a placeholder apiKey the gateway ignores),
 * a live model list adopted through context.publish, and stream delegation
 * that routes each model through the upstream Pi API stamped on it.
 */
export function createDedicatedProvider(
  baseUrl: string,
  refresh: RefreshDedicatedCatalog,
): Provider {
  let liveModels: Model<Api>[] = [];

  return {
    id: DEDICATED_PROVIDER_ID,
    name: "Aperture",
    baseUrl,
    auth: {
      apiKey: {
        name: "Aperture",
        // The gateway injects the real credential; there is no user key to
        // check for, so the provider always counts as configured.
        check: async () => ({ type: "api_key", source: "aperture gateway" }),
        resolve: async () => ({
          auth: { apiKey: "-" },
          source: "aperture gateway",
        }),
      },
    },
    getModels: () => liveModels,
    refreshModels: async (context) => {
      const models = await refresh(context);
      if (models === undefined) return;
      await context.publish({
        update: () => {
          liveModels = models;
        },
      });
    },
    stream: buildStream(),
    streamSimple: buildStreamSimple(),
  };
}
