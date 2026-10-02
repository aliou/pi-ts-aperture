import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { embedsModelIdInPath } from "../../../src/base-url-routing";
import type {
  Api,
  AssistantMessageEventStream,
  Model,
} from "../../shared/types";

export function qualifyModelId<T extends Api>(
  providerName: string,
  model: Model<T>,
): Model<T> {
  // Path-embedding APIs (Gemini/Vertex/Bedrock) put the model id in the URL,
  // which the gateway forwards verbatim upstream; qualifying it 404s. Body
  // APIs keep the qualified id so the gateway can disambiguate duplicates.
  if (embedsModelIdInPath(model.api)) return model;
  // Skip re-prefixing an id a stale pre-reload wrapper already prefixed.
  const prefix = `${providerName}/`;
  if (model.id.startsWith(prefix)) return model;
  return { ...model, id: `${prefix}${model.id}` };
}

function eventMessage(event: AssistantMessageEvent): AssistantMessage {
  if (event.type === "done") return event.message;
  if (event.type === "error") return event.error;
  return event.partial;
}

async function pipeWithModelId(
  source: AssistantMessageEventStream,
  target: AssistantMessageEventStream,
  modelId: string,
): Promise<void> {
  for await (const event of source) {
    eventMessage(event).model = modelId;
    target.push(event);
  }
  const result = await source.result();
  result.model = modelId;
  target.end(result);
}

/**
 * Report `modelId` on every message the stream emits.
 *
 * Adapters stamp the request model id onto the AssistantMessage, so a
 * qualified request id would land in the session file. Pi restores a session
 * model from the last assistant message and only knows the bare picker id.
 */
export function withModelId(
  source: AssistantMessageEventStream,
  modelId: string,
): AssistantMessageEventStream {
  const target = createAssistantMessageEventStream();
  void pipeWithModelId(source, target, modelId);
  return target;
}
