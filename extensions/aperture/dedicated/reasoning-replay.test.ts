/**
 * Wire-shape tests for dedicated-path reasoning replay: the real catalog
 * refresh (ApertureClient, buildModels) plus real pi-ai openai-completions
 * streaming. Only `fetch` is mocked — a dispatcher that serves the model
 * catalog, fails models.dev, and answers chat completions with a
 * NeuralWatt-style SSE stream carrying reasoning deltas under `reasoning`.
 */
import type {
  Api,
  Context,
  Model,
  Provider,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai/compat";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { MODELS_DEV_URL } from "../../../src/model-metadata";
import {
  REASONING_REPLAY,
  type ReasoningReplay,
} from "../../../src/reasoning-replay";
import type { ResolvedConfig } from "../../shared/config/types";

const GATEWAY = "https://ai.pango-lin.ts.net";

const mocks = vi.hoisted(() => ({
  config: {
    baseUrl: "https://ai.pango-lin.ts.net",
    shouldSendProvenanceHeaders: true,
    onboardingDone: true,
    onboarding: { enabled: false },
    proxy: { enabled: false, upstreamProviders: [] },
    dedicated: { enabled: true, providers: [] },
    connectors: { enabled: false, pinnedTools: [], discoveryTools: true },
  } as ResolvedConfig,
}));

vi.mock("../../shared/config/loader", () => ({
  configLoader: { load: () => {}, getConfig: () => mocks.config },
}));

const { createDedicatedProvider } = await import("./provider");
const { refreshDedicatedCatalog } = await import("./runtime");
const { withReasoningReplay, reasoningReplayFor } = await import(
  "./reasoning-replay"
);

const THINKING = "turn-1 thinking";
const ANSWER = "turn-1 answer";

const KNOBBED_IDS = [
  "neuralwatt/kimi-k3",
  "neuralwatt/kimi-k3-fast",
  "neuralwatt/kimi-k3-flex",
  "synthetic/hf:moonshotai/Kimi-K3",
  "neuralwatt/deepseek-v4.1-flash",
  "synthetic/hf:deepseek-ai/DeepSeek-V4.1-Flash",
  "synthetic/syn:large:text",
  "synthetic/syn:large:vision",
  "synthetic/hf:zai-org/GLM-5.3-Flash",
] as const;

const KNOBLESS_IDS = [
  "synthetic/hf:zai-org/GLM-4.7-Flash",
  "synthetic/syn:small:text",
  "synthetic/hf:openai/gpt-oss-120b",
  "synthetic/hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
] as const;

function catalogEntry(id: string, providerId: string) {
  return {
    id,
    object: "model",
    created: 0,
    owned_by: providerId,
    supported_endpoints: ["/v1/chat/completions"],
    metadata: {
      provider: {
        id: providerId,
        name: providerId,
        description: "",
        requires_client_auth: false,
      },
    },
  };
}

const CATALOG = {
  data: [
    ...["kimi-k3", "kimi-k3-fast", "kimi-k3-flex", "deepseek-v4.1-flash"].map(
      (id) => catalogEntry(id, "neuralwatt"),
    ),
    ...[
      "hf:moonshotai/Kimi-K3",
      "hf:deepseek-ai/DeepSeek-V4.1-Flash",
      "syn:large:text",
      "syn:large:vision",
      "hf:zai-org/GLM-5.3-Flash",
      "hf:zai-org/GLM-4.7-Flash",
      "syn:small:text",
      "hf:openai/gpt-oss-120b",
      "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
    ].map((id) => catalogEntry(id, "synthetic")),
  ],
};

function sseResponse(chunks: Record<string, unknown>[]): Response {
  const body = `${chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function neuralwattStyleChunks(): Record<string, unknown>[] {
  const chunk = (delta: Record<string, unknown>, finishReason?: string) => ({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 0,
    model: "m",
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  });
  return [
    chunk({ role: "assistant", content: "" }),
    chunk({ reasoning: THINKING }),
    chunk({ content: ANSWER }),
    {
      ...chunk({}, "stop"),
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    },
  ];
}

/** Bodies of every chat-completions request the stub has served, in order. */
const completionBodies: string[] = [];

const fetchStub = vi.fn(
  async (input: unknown, init?: { body?: unknown }): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (url === `${GATEWAY}/v1/models`) {
      return new Response(JSON.stringify(CATALOG), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url === MODELS_DEV_URL) {
      return new Response("unavailable", { status: 500 });
    }
    if (url.endsWith("/chat/completions")) {
      const body =
        init?.body != null
          ? String(init.body)
          : await (input as Request).text();
      completionBodies.push(body);
      return sseResponse(neuralwattStyleChunks());
    }
    throw new Error(`unexpected fetch: ${url}`);
  },
);

function userMessage(content: string) {
  return { role: "user" as const, content, timestamp: 0 };
}

function lastCompletionBody(): string {
  const body = completionBodies.at(-1);
  if (!body) throw new Error("no chat-completions request captured");
  return body;
}

function lastCompletionJson(): Record<string, unknown> {
  return JSON.parse(lastCompletionBody()) as Record<string, unknown>;
}

function assistantWireMessage(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const messages = body.messages as Record<string, unknown>[];
  const assistant = messages.find((m) => m.role === "assistant");
  if (!assistant) throw new Error("no assistant message in payload");
  return assistant;
}

let provider: Provider;
let models: Model<Api>[];

function catalogModel(id: string): Model<Api> {
  const model = models.find((m) => m.id === id);
  if (!model) throw new Error(`catalog does not contain ${id}`);
  return model;
}

/** Turn 1 streams the mocked reasoning; turn 2 feeds the result back. */
async function runTwoTurns(model: Model<Api>) {
  const turn1 = await provider
    .streamSimple(model, { messages: [userMessage("hi")] }, { apiKey: "-" })
    .result();
  const turn2 = await provider
    .streamSimple(
      model,
      { messages: [userMessage("hi"), turn1, userMessage("and?")] },
      { apiKey: "-" },
    )
    .result();
  return { turn1, turn2, turn2Body: lastCompletionJson() };
}

beforeAll(async () => {
  vi.stubGlobal("fetch", fetchStub);
  provider = createDedicatedProvider(`${GATEWAY}/v1`, (context) =>
    refreshDedicatedCatalog(context, () => []),
  );
  const context = {
    allowNetwork: true,
    force: true,
    signal: new AbortController().signal,
    publish: async (publication: { update?: () => void }) => {
      publication.update?.();
      return true;
    },
  } as unknown as RefreshModelsContext;
  await provider.refreshModels?.(context);
  models = provider.getModels();
});

beforeEach(() => {
  // vitest mockReset:true wipes implementations between tests; re-apply.
  fetchStub.mockClear();
  completionBodies.length = 0;
});

describe("catalog stamping", () => {
  test.each(KNOBBED_IDS)("%s carries the table knob", (id) => {
    const bareId = id.slice(id.indexOf("/") + 1);
    expect(reasoningReplayFor(catalogModel(id))).toEqual(
      REASONING_REPLAY[bareId],
    );
    expect(
      (catalogModel(id) as { reasoningReplay?: ReasoningReplay })
        .reasoningReplay,
    ).toEqual(REASONING_REPLAY[bareId]);
  });

  test.each(KNOBLESS_IDS)("%s stays knob-less", (id) => {
    expect(reasoningReplayFor(catalogModel(id))).toBeUndefined();
    expect(
      (catalogModel(id) as { reasoningReplay?: ReasoningReplay })
        .reasoningReplay,
    ).toBeUndefined();
  });
});

describe("turn-2 wire shape", () => {
  test("turn 1 streams reasoning deltas and finishes cleanly", async () => {
    const { turn1 } = await runTwoTurns(catalogModel("neuralwatt/kimi-k3"));
    expect(turn1.stopReason).toBe("stop");
    const thinking = turn1.content.find((block) => block.type === "thinking");
    expect(thinking).toMatchObject({ type: "thinking", thinking: THINKING });
  });

  test.each(
    KNOBBED_IDS,
  )("%s replays turn-1 thinking as reasoning_content", async (id) => {
    const { turn2Body } = await runTwoTurns(catalogModel(id));
    const assistant = assistantWireMessage(turn2Body);
    expect(assistant.reasoning_content).toBe(THINKING);
    expect(assistant).not.toHaveProperty("reasoning");
    if (id === "synthetic/hf:zai-org/GLM-5.3-Flash") {
      expect(turn2Body.chat_template_kwargs).toEqual({
        clear_thinking: false,
      });
    } else {
      expect(turn2Body).not.toHaveProperty("chat_template_kwargs");
    }
  });

  test.each(
    KNOBLESS_IDS,
  )("%s keeps pi-ai's recorded-signature replay byte-identical to the bare API", async (id) => {
    const model = catalogModel(id);
    const { turn1, turn2Body } = await runTwoTurns(model);
    const assistant = assistantWireMessage(turn2Body);
    expect(assistant.reasoning).toBe(THINKING);
    expect(assistant).not.toHaveProperty("reasoning_content");
    expect(turn2Body).not.toHaveProperty("chat_template_kwargs");

    // The pre-change shape: the same model and transcript streamed straight
    // through pi-ai's openai-completions API without the dedicated wrapper.
    const context: Context = {
      messages: [userMessage("hi"), turn1, userMessage("and?")],
    };
    const api = getApiProvider("openai-completions");
    if (!api) throw new Error("openai-completions API not registered");
    await api.streamSimple(model, context, { apiKey: "-" }).result();
    expect(lastCompletionBody()).toBe(JSON.stringify(turn2Body));
  });
});

describe("withReasoningReplay", () => {
  test("non-openai-completions APIs pass options through untouched", () => {
    const model = {
      id: "neuralwatt/kimi-k3",
      api: "anthropic-messages",
    } as Model<Api>;
    const options = { apiKey: "-" };
    expect(withReasoningReplay(model, options)).toBe(options);
    expect(reasoningReplayFor(model)).toEqual({ field: "reasoning_content" });
  });

  test("knob-less models get the same options reference back", () => {
    const model = {
      id: "synthetic/syn:small:text",
      api: "openai-completions",
    } as Model<Api>;
    const options = { apiKey: "-" };
    expect(withReasoningReplay(model, options)).toBe(options);
  });

  test("a stamped knob wins over the repo table for the same id", async () => {
    const model = {
      id: "neuralwatt/kimi-k3",
      api: "openai-completions",
      reasoningReplay: { field: "reasoning" },
    } as Model<Api>;
    const options = withReasoningReplay(model, undefined);
    const payload = {
      messages: [{ role: "assistant", content: "a1", reasoning_content: "t1" }],
    };
    const transformed: unknown = await options?.onPayload?.(payload, model);
    const result = transformed as { messages: Record<string, unknown>[] };
    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "a1",
      reasoning: "t1",
    });
  });

  test("a malformed stamp fails open to the repo table", async () => {
    const model = {
      id: "neuralwatt/kimi-k3",
      api: "openai-completions",
      reasoningReplay: "garbage",
    } as unknown as Model<Api>;
    const options = withReasoningReplay(model, undefined);
    const payload = {
      messages: [{ role: "assistant", content: "a1", reasoning: "t1" }],
    };
    const transformed: unknown = await options?.onPayload?.(payload, model);
    const result = transformed as { messages: Record<string, unknown>[] };
    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "a1",
      reasoning_content: "t1",
    });
  });
});
