import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  createAssistantMessageEventStream,
  type Model,
  type TranscriptContext,
} from "@earendil-works/pi-ai";

/**
 * Match same-model history to the transport id before pi-ai converts it.
 * Session messages keep public/catalog ids for restore; pi-ai compares them
 * with the request id to decide whether reasoning and signatures are safe to
 * replay. Copy only matching assistant envelopes, leaving session state
 * untouched.
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
 * rewritten request id would otherwise land in the session file and fail
 * model restore on resume.
 */
export function withModelId(
  source: AssistantMessageEventStream,
  modelId: string,
): AssistantMessageEventStream {
  const target = createAssistantMessageEventStream();
  void pipeWithModelId(source, target, modelId);
  return target;
}
