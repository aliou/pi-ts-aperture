import type { AnyModel } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Chat and classifier models known to the registry. The registry facade has
 * no combined accessor — `getAll()` is chat-only — so classifiers ride on
 * `getModelsOfType("classifier")`. Image models are not part of a snapshot.
 */
export function chatAndClassifierModels(
  registry: ExtensionContext["modelRegistry"],
): AnyModel[] {
  return [...registry.getAll(), ...registry.getModelsOfType("classifier")];
}
