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
  TranscriptContext,
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

/**
 * Match same-model history to the transport id before pi-ai converts it.
 * Session messages keep public ids for restore; pi-ai compares them with the
 * request id to decide whether reasoning and signatures are safe to replay.
 * Copy only matching assistant envelopes, leaving session state untouched.
 */
export function withRequestModelId(
  context: TranscriptContext,
  model: Model<Api>,
  requestModel: Model<Api>,
): TranscriptContext {
  if (model.id === requestModel.id) return context;
  if (!context.messages?.length) return context;

  return {
    ...context,
    messages: context.messages.map((message) => {
      if (message.role !== "assistant") return message;
      if (message.provider !== model.provider) return message;
      if (message.api !== model.api) return message;
      if (message.model !== model.id) return message;
      return { ...message, model: requestModel.id };
    }),
  };
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
