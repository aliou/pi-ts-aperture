import {
  type Api,
  type AssistantMessage,
  createAssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import {
  registerApiProvider,
  unregisterApiProviders,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildStream, buildStreamSimple } from "./api-routing";
import type { Context } from "./types";

const SOURCE_ID = "shared-api-routing-test";

function model(id: string, api: Api): Model<Api> {
  return { provider: "aperture", id, api } as Model<Api>;
}

function assistantMessage(
  id: string,
  api: Api,
  provider = "aperture",
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api,
    provider,
    model: id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

function fakeStream(emittedModelId: string, api: Api) {
  const stream = createAssistantMessageEventStream();
  const msg = assistantMessage(emittedModelId, api);
  queueMicrotask(() => {
    stream.push({ type: "start", partial: { ...msg } });
    stream.push({ type: "done", reason: "stop", message: { ...msg } });
    stream.end({ ...msg });
  });
  return stream;
}

function fakeApiProvider(api: Api) {
  const provider = {
    api,
    stream: vi.fn((reqModel: Model<Api>) => fakeStream(reqModel.id, api)),
    streamSimple: vi.fn((reqModel: Model<Api>) => fakeStream(reqModel.id, api)),
  };
  registerApiProvider(provider, SOURCE_ID);
  return provider;
}

afterEach(() => {
  unregisterApiProviders(SOURCE_ID);
});

// Path-embedding APIs (Gemini/Vertex/Bedrock) build the request URL from the
// model id, and the gateway forwards those paths verbatim upstream, so the
// provider-qualified catalog id 404s there. These tests dispatch through
// buildStream/buildStreamSimple into a registered fake API provider and
// assert both the stripped id handed downstream and the catalog id restored
// on emitted assistant messages.
describe("dedicated stream dispatch", () => {
  test("hands the bare id to Gemini/Vertex/Bedrock APIs and restores catalog id on stream", async () => {
    const gemini = fakeApiProvider("google-generative-ai");
    const vertex = fakeApiProvider("google-vertex");
    const bedrock = fakeApiProvider("bedrock-converse-stream");
    const context = {} as Context;

    const geminiStream = buildStreamSimple()(
      model("acme/gemini-3.5-flash", "google-generative-ai"),
      context,
    );
    expect(gemini.streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "gemini-3.5-flash",
    });
    const events = [];
    for await (const event of geminiStream) events.push(event);
    expect(events[0]).toMatchObject({
      type: "start",
      partial: { model: "acme/gemini-3.5-flash" },
    });
    expect(events[1]).toMatchObject({
      type: "done",
      message: { model: "acme/gemini-3.5-flash" },
    });
    const geminiResult = await geminiStream.result();
    expect(geminiResult).toMatchObject({
      model: "acme/gemini-3.5-flash",
    });

    const vertexStream = buildStream()(
      model("acme/gemini-2.5-pro", "google-vertex"),
      context,
    );
    expect(vertex.stream.mock.calls[0]?.[0]).toMatchObject({
      id: "gemini-2.5-pro",
    });
    const vertexResult = await vertexStream.result();
    expect(vertexResult).toMatchObject({
      model: "acme/gemini-2.5-pro",
    });

    const bedrockStream = buildStream()(
      model("acme/anthropic.claude-sonnet-4-5", "bedrock-converse-stream"),
      context,
    );
    expect(bedrock.stream.mock.calls[0]?.[0]).toMatchObject({
      id: "anthropic.claude-sonnet-4-5",
    });
    const bedrockResult = await bedrockStream.result();
    expect(bedrockResult).toMatchObject({
      model: "acme/anthropic.claude-sonnet-4-5",
    });
  });

  test("rewrites prior same-model assistant messages in request context without mutating caller", async () => {
    const gemini = fakeApiProvider("google-generative-ai");
    const prior = assistantMessage(
      "google/gemini-4-hydrogen",
      "google-generative-ai",
    );
    const other = assistantMessage(
      "anthropic/claude-opus-5",
      "anthropic-messages",
    );
    const context = { messages: [prior, other] } as unknown as Context;

    const stream = buildStreamSimple()(
      model("google/gemini-4-hydrogen", "google-generative-ai"),
      context,
    );
    await stream.result();

    const passedContext = gemini.streamSimple.mock.calls[0]?.[1];
    expect(passedContext?.messages[0]).toMatchObject({
      model: "gemini-4-hydrogen",
    });
    expect(passedContext?.messages[1]).toBe(other);
    expect(prior.model).toBe("google/gemini-4-hydrogen");
  });

  test("strips only the first segment when the upstream id contains slashes", async () => {
    const gemini = fakeApiProvider("google-generative-ai");

    const stream = buildStreamSimple()(
      model("acme/hf:org/some-model", "google-generative-ai"),
      {} as Context,
    );
    expect(gemini.streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "hf:org/some-model",
    });
    const result = await stream.result();
    expect(result).toMatchObject({
      model: "acme/hf:org/some-model",
    });
  });

  test("keeps qualified ids and passes stream through for body-carried model APIs", () => {
    const completions = fakeApiProvider("openai-completions");
    const responses = fakeApiProvider("openai-responses");
    const anthropic = fakeApiProvider("anthropic-messages");
    const context = {} as Context;

    const s1 = buildStreamSimple()(
      model("acme/text-model-1", "openai-completions"),
      context,
    );
    expect(completions.streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "acme/text-model-1",
    });
    expect(s1).toBe(completions.streamSimple.mock.results[0]?.value);

    const s2 = buildStream()(
      model("acme/response-model-1", "openai-responses"),
      context,
    );
    expect(responses.stream.mock.calls[0]?.[0]).toMatchObject({
      id: "acme/response-model-1",
    });
    expect(s2).toBe(responses.stream.mock.results[0]?.value);

    const s3 = buildStream()(
      model("acme/claude-opus-5", "anthropic-messages"),
      context,
    );
    expect(anthropic.stream.mock.calls[0]?.[0]).toMatchObject({
      id: "acme/claude-opus-5",
    });
    expect(s3).toBe(anthropic.stream.mock.results[0]?.value);
  });

  test("leaves already-bare ids untouched and passes stream through", () => {
    const gemini = fakeApiProvider("google-generative-ai");

    const stream = buildStreamSimple()(
      model("gemini-3.5-flash", "google-generative-ai"),
      {} as Context,
    );
    expect(gemini.streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "gemini-3.5-flash",
    });
    expect(stream).toBe(gemini.streamSimple.mock.results[0]?.value);
  });
});
