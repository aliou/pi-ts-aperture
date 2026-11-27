import { embedsModelIdInPath } from "../../../src/base-url-routing";
import type { AnyModel } from "../../shared/types";

export { withModelId, withRequestModelId } from "../../../src/model-id";

export function qualifyModelId<T extends AnyModel>(
  providerName: string,
  model: T,
): T {
  // Path-embedding APIs (Gemini/Vertex/Bedrock) put the model id in the URL,
  // which the gateway forwards verbatim upstream; qualifying it 404s. Body
  // APIs keep the qualified id so the gateway can disambiguate duplicates.
  if (embedsModelIdInPath(model.api)) return model;
  // Skip re-prefixing an id a stale pre-reload wrapper already prefixed.
  const prefix = `${providerName}/`;
  if (model.id.startsWith(prefix)) return model;
  return { ...model, id: `${prefix}${model.id}` };
}
