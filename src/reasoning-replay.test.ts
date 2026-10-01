import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import {
  applyReasoningReplay,
  parseReasoningReplay,
  REASONING_REPLAY,
  type ReasoningReplay,
  resolveReasoningReplay,
  wrapReasoningReplayOnPayload,
} from "./reasoning-replay";

const model = { id: "m", provider: "aperture" } as Model<Api>;

/** The field pi-ai would have recorded the replay under for this knob. */
function sourceField(knob: ReasoningReplay): string {
  return knob.field === "reasoning" ? "reasoning_content" : "reasoning";
}

function replayPayload(source: string, extra: Record<string, unknown> = {}) {
  return {
    model: "m",
    messages: [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1", [source]: "turn-1 thinking" },
      { role: "user", content: "q2" },
    ],
    ...extra,
  };
}

describe("REASONING_REPLAY table", () => {
  // Pin the exact contents so deleting or renaming an entry fails here.
  test("contains exactly the evidence-reviewed entries", () => {
    expect(REASONING_REPLAY).toEqual({
      "kimi-k3": { field: "reasoning_content" },
      "kimi-k3-fast": { field: "reasoning_content" },
      "kimi-k3-flex": { field: "reasoning_content" },
      "hf:moonshotai/Kimi-K3": { field: "reasoning_content" },
      "deepseek-v4.1-flash": { field: "reasoning_content" },
      "hf:deepseek-ai/DeepSeek-V4.1-Flash": { field: "reasoning_content" },
      "syn:large:text": { field: "reasoning_content" },
      "syn:large:vision": { field: "reasoning_content" },
      "hf:zai-org/GLM-5.3-Flash": {
        field: "reasoning_content",
        templateKwargs: { clear_thinking: false },
      },
    });
  });

  test.each(
    Object.entries(REASONING_REPLAY),
  )("%s replays into its configured field", (id, knob) => {
    expect(resolveReasoningReplay(id)).toEqual(knob);
    expect(resolveReasoningReplay(`someprovider/${id}`)).toEqual(knob);

    const source = sourceField(knob);
    const payload = replayPayload(source);
    const result = applyReasoningReplay(payload, knob) as ReturnType<
      typeof replayPayload
    >;

    const assistant = result.messages[1] as Record<string, unknown>;
    if (knob.field) {
      expect(assistant[knob.field]).toBe("turn-1 thinking");
      expect(source in assistant).toBe(false);
    }
    if (knob.templateKwargs) {
      expect((result as Record<string, unknown>).chat_template_kwargs).toEqual(
        knob.templateKwargs,
      );
    }
  });

  test.each([
    "hf:zai-org/GLM-4.7-Flash",
    "syn:small:text",
    "hf:openai/gpt-oss-120b",
    "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
  ])("%s deliberately stays knob-less", (id) => {
    expect(resolveReasoningReplay(id)).toBeUndefined();
    expect(resolveReasoningReplay(`synthetic/${id}`)).toBeUndefined();
  });
});

describe("resolveReasoningReplay", () => {
  test("matches by exact string only, never prefix or substring", () => {
    expect(resolveReasoningReplay("kimi-k3-turbo")).toBeUndefined();
    expect(resolveReasoningReplay("not-kimi-k3")).toBeUndefined();
    expect(resolveReasoningReplay("Kimi-K3")).toBeUndefined();
    expect(resolveReasoningReplay("neuralwatt/kimi-k3/extra")).toBeUndefined();
    // Only the first segment is stripped: deeper prefixes never match.
    expect(resolveReasoningReplay("synthetic/nested/kimi-k3")).toBeUndefined();
  });

  test("inherited Object members are knob-less, bare or qualified", () => {
    expect(resolveReasoningReplay("constructor")).toBeUndefined();
    expect(resolveReasoningReplay("toString")).toBeUndefined();
    expect(resolveReasoningReplay("neuralwatt/constructor")).toBeUndefined();
    expect(resolveReasoningReplay("neuralwatt/toString")).toBeUndefined();
  });

  test("a gateway-declared reasoning_replay wins over the table", () => {
    const declared = { field: "reasoning" };
    expect(
      resolveReasoningReplay("neuralwatt/kimi-k3", {
        id: "kimi-k3",
        reasoning_replay: declared,
      }),
    ).toEqual(declared);
  });

  test("a gateway declaration maps an id the table does not carry", () => {
    const declared = {
      field: "reasoning_content",
      templateKwargs: { clear_thinking: false },
    };
    expect(
      resolveReasoningReplay("openai/gpt-5", {
        id: "gpt-5",
        reasoning_replay: declared,
      }),
    ).toEqual(declared);
  });

  test.each([
    ["not an object", "garbage"],
    ["an array", ["reasoning"]],
    ["an empty object", {}],
    ["an unknown field", { field: "thoughts" }],
    ["non-object templateKwargs", { templateKwargs: "clear_thinking" }],
  ])("invalid gateway metadata (%s) fails open to the table", (_label, reasoning_replay) => {
    expect(
      resolveReasoningReplay("neuralwatt/kimi-k3", {
        id: "kimi-k3",
        reasoning_replay,
      }),
    ).toEqual({ field: "reasoning_content" });
    expect(
      resolveReasoningReplay("openai/gpt-5", { id: "gpt-5", reasoning_replay }),
    ).toBeUndefined();
  });
});

describe("applyReasoningReplay", () => {
  const knob: ReasoningReplay = { field: "reasoning_content" };

  test("moves the replay into the target field on every assistant message", () => {
    const payload = {
      messages: [
        { role: "assistant", content: "a1", reasoning: "t1" },
        { role: "user", content: "q", reasoning: "not-assistant" },
        { role: "assistant", content: "a2", reasoning: "t2" },
      ],
    };
    const result = applyReasoningReplay(payload, knob) as typeof payload;

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "a1",
      reasoning_content: "t1",
    });
    expect(result.messages[1]).toEqual({
      role: "user",
      content: "q",
      reasoning: "not-assistant",
    });
    expect(result.messages[2]).toEqual({
      role: "assistant",
      content: "a2",
      reasoning_content: "t2",
    });
  });

  test("a pre-set non-empty target wins; the duplicate source is dropped", () => {
    const payload = {
      messages: [
        {
          role: "assistant",
          content: "a1",
          reasoning: "from-signature",
          reasoning_content: "already-set",
        },
      ],
    };
    const result = applyReasoningReplay(payload, knob) as typeof payload;

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "a1",
      reasoning_content: "already-set",
    });
  });

  test("an empty pre-set target is overwritten by the populated source", () => {
    // The #102 shape: pi-ai's requiresReasoningContentOnAssistantMessages
    // appends reasoning_content: "" next to the populated reasoning replay.
    const payload = {
      messages: [
        {
          role: "assistant",
          content: "a1",
          reasoning: "from-signature",
          reasoning_content: "",
        },
      ],
    };
    const result = applyReasoningReplay(payload, knob) as typeof payload;

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "a1",
      reasoning_content: "from-signature",
    });
  });

  test("an empty source is never moved into the target", () => {
    const payload = {
      messages: [{ role: "assistant", content: "a1", reasoning: "" }],
    };
    const result = applyReasoningReplay(payload, knob) as typeof payload;

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "a1",
      reasoning: "",
    });
  });

  test("no source replay leaves the message untouched", () => {
    const payload = {
      messages: [{ role: "assistant", content: "a1" }],
    };
    const result = applyReasoningReplay(payload, knob) as typeof payload;

    expect(result.messages[0]).toEqual({ role: "assistant", content: "a1" });
  });

  test("templateKwargs shallow-merge into chat_template_kwargs and win on conflicts", () => {
    const payload = replayPayload("reasoning", {
      chat_template_kwargs: { enable_thinking: true, clear_thinking: true },
    });
    const result = applyReasoningReplay(payload, {
      field: "reasoning_content",
      templateKwargs: { clear_thinking: false },
    }) as Record<string, unknown>;

    expect(result.chat_template_kwargs).toEqual({
      enable_thinking: true,
      clear_thinking: false,
    });
  });

  test("a templateKwargs-only knob leaves messages untouched", () => {
    const payload = replayPayload("reasoning");
    const result = applyReasoningReplay(payload, {
      templateKwargs: { clear_thinking: false },
    }) as ReturnType<typeof replayPayload> & Record<string, unknown>;

    expect(result.messages[1]).toEqual({
      role: "assistant",
      content: "a1",
      reasoning: "turn-1 thinking",
    });
    expect(result.chat_template_kwargs).toEqual({ clear_thinking: false });
  });

  test("non-object payloads pass through", () => {
    expect(applyReasoningReplay("nope", knob)).toBe("nope");
    expect(applyReasoningReplay(undefined, knob)).toBeUndefined();
  });
});

describe("wrapReasoningReplayOnPayload", () => {
  const knob: ReasoningReplay = { field: "reasoning_content" };

  test("the caller's onPayload runs first on the original payload; the transform applies to its replacement", async () => {
    const seenByCaller: unknown[] = [];
    const caller = vi.fn((payload: unknown) => {
      // Snapshot at call time: the transform later mutates the messages the
      // caller's replacement shares with the original.
      seenByCaller.push(structuredClone(payload));
      const replacement = {
        ...(payload as Record<string, unknown>),
        extra: "caller-marker",
      };
      return replacement;
    });
    const options = { onPayload: caller } as StreamOptions;
    const wrapped = wrapReasoningReplayOnPayload(options, knob);

    const original = replayPayload("reasoning");
    const transformed: unknown = await wrapped.onPayload?.(original, model);
    const result = transformed as Record<string, unknown>;

    // The caller saw the payload before the replay move.
    const seen = seenByCaller[0] as ReturnType<typeof replayPayload>;
    expect(seen.messages[1]).toHaveProperty("reasoning", "turn-1 thinking");
    expect(seen.messages[1]).not.toHaveProperty("reasoning_content");
    // The transform operated on the caller's replacement.
    expect(result.extra).toBe("caller-marker");
    expect((result.messages as Record<string, unknown>[])[1]).toHaveProperty(
      "reasoning_content",
      "turn-1 thinking",
    );
    expect(result).not.toBe(original);
  });

  test("a caller returning undefined keeps the original payload for the transform", async () => {
    const caller = vi.fn(() => undefined);
    const wrapped = wrapReasoningReplayOnPayload(
      { onPayload: caller } as StreamOptions,
      knob,
    );

    const original = replayPayload("reasoning");
    const transformed: unknown = await wrapped.onPayload?.(original, model);
    const result = transformed as ReturnType<typeof replayPayload>;

    expect(caller).toHaveBeenCalledOnce();
    expect(result.messages[1]).toHaveProperty(
      "reasoning_content",
      "turn-1 thinking",
    );
  });

  test("all other options pass through untouched", async () => {
    const onResponse = vi.fn();
    const fetchFn = vi.fn();
    const options = {
      onResponse,
      fetch: fetchFn,
      sessionId: "s-1",
      maxTokens: 64,
      // Unknown future options must survive the spread too.
      onProviderStreamEvent: vi.fn(),
    } as unknown as StreamOptions;
    const wrapped = wrapReasoningReplayOnPayload(options, {
      templateKwargs: { clear_thinking: false },
    });

    expect(wrapped.onResponse).toBe(onResponse);
    expect(wrapped.fetch).toBe(fetchFn);
    expect(wrapped.sessionId).toBe("s-1");
    expect(wrapped.maxTokens).toBe(64);
    expect((wrapped as Record<string, unknown>).onProviderStreamEvent).toBe(
      options.onProviderStreamEvent,
    );

    const result = await wrapped.onPayload?.(replayPayload("reasoning"), model);
    expect(result).toHaveProperty("chat_template_kwargs", {
      clear_thinking: false,
    });
  });
});

describe("parseReasoningReplay", () => {
  test("round-trips a valid knob and rejects malformed shapes", () => {
    expect(parseReasoningReplay({ field: "reasoning" })).toEqual({
      field: "reasoning",
    });
    expect(
      parseReasoningReplay({
        field: "reasoning_content",
        templateKwargs: { a: 1 },
      }),
    ).toEqual({ field: "reasoning_content", templateKwargs: { a: 1 } });
    expect(parseReasoningReplay(undefined)).toBeUndefined();
    expect(parseReasoningReplay(null)).toBeUndefined();
    expect(parseReasoningReplay("reasoning")).toBeUndefined();
    expect(parseReasoningReplay({ field: "thoughts" })).toBeUndefined();
    expect(parseReasoningReplay({ templateKwargs: [] })).toBeUndefined();
    expect(parseReasoningReplay({})).toBeUndefined();
  });
});
