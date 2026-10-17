import type {
  Api,
  AssistantMessageEventStream,
  Model,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import {
  type AssistantMessage,
  type AssistantMessageEvent,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { embedsModelIdInPath } from "../base-url-routing";

export function qualifyModelId<T extends { id: string; api: Api }>(
  providerName: string,
  model: T,
): T {
  if (embedsModelIdInPath(model.api)) return model;
  const prefix = `${providerName}/`;
  if (model.id.startsWith(prefix)) return model;
  return { ...model, id: `${prefix}${model.id}` };
}

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
    const message = eventMessage(event);
    message.model = modelId;
    if (message.deferred) message.deferred = { ...message.deferred, modelId };
    target.push(event);
  }
  const result = await source.result();
  result.model = modelId;
  if (result.deferred) result.deferred = { ...result.deferred, modelId };
  target.end(result);
}

export function withModelId(
  source: AssistantMessageEventStream,
  modelId: string,
): AssistantMessageEventStream {
  const target = createAssistantMessageEventStream();
  void pipeWithModelId(source, target, modelId);
  return target;
}
