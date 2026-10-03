import type { AssistantMessage, Model } from "@earendil-works/pi-ai";
import { transformMessages } from "@earendil-works/pi-ai/api/transform-messages";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { describe, expect, test, vi } from "vitest";
import { qualifyModelId, withRequestModelId } from "./model-id";

const model = {
  provider: "local-provider",
  id: "kimi-k3",
  api: "openai-completions",
  input: ["text"],
} as Model<"openai-completions">;

function assistant(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    provider: model.provider,
    api: model.api,
    model: model.id,
    content: [
      {
        type: "thinking",
        thinking: "reasoning",
        thinkingSignature: "reasoning",
      },
      {
        type: "thinking",
        thinking: "",
        thinkingSignature: "encrypted",
        redacted: true,
      },
      { type: "text", text: "answer", textSignature: "signed text" },
      {
        type: "toolCall",
        id: "call|item",
        name: "lookup",
        arguments: {},
        thoughtSignature: "signed call",
      },
    ],
    stopReason: "toolUse",
    timestamp: 1,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    ...overrides,
  };
}

describe("withRequestModelId", () => {
  test("preserves same-model reasoning, redacted thinking, signatures and tool ids without changing history", () => {
    const previous = assistant();
    Object.freeze(previous);
    Object.freeze(previous.content);
    const context = normalizeContext({
      systemPrompt: "Use lookup.",
      messages: [
        previous,
        {
          role: "toolResult",
          toolCallId: "call|item",
          toolName: "lookup",
          content: [{ type: "text", text: "result" }],
          isError: false,
          timestamp: 2,
        },
        { role: "user", content: "Continue", timestamp: 3 },
      ],
    });
    Object.freeze(context.messages);
    Object.freeze(context);
    const snapshot = structuredClone(context);
    const requestModel = qualifyModelId("gateway-provider", model);

    const request = withRequestModelId(context, model, requestModel);
    const normalizeToolCallId = vi.fn(() => "normalized");
    const transformed = transformMessages(
      request.messages,
      requestModel,
      normalizeToolCallId,
    );

    expect(request.messages[1]).not.toBe(previous);
    expect((request.messages[1] as AssistantMessage).content).toBe(
      previous.content,
    );
    expect(transformed[1]).toMatchObject({
      model: requestModel.id,
      content: previous.content,
    });
    expect(normalizeToolCallId).not.toHaveBeenCalled();
    expect(transformed[2]).toMatchObject({
      role: "toolResult",
      toolCallId: "call|item",
    });
    expect(request.messages[0]).toBe(context.messages[0]);
    expect(request.messages[2]).toBe(context.messages[2]);
    expect(request.messages[3]).toBe(context.messages[3]);
    expect(context).toEqual(snapshot);
  });

  test.each([
    { provider: "another-provider" },
    { api: "anthropic-messages" },
    { model: "another-model" },
  ])("leaves real cross-model history unchanged: %j", (overrides) => {
    const previous = assistant(overrides);
    const context = normalizeContext({ messages: [previous] });
    const requestModel = qualifyModelId("gateway-provider", model);
    const request = withRequestModelId(context, model, requestModel);
    expect(request.messages[0]).toBe(previous);
    const normalizeToolCallId = vi.fn(() => "normalized");
    const transformed = transformMessages(
      request.messages,
      requestModel,
      normalizeToolCallId,
    );
    expect((transformed[0] as AssistantMessage).content).toEqual([
      { type: "text", text: "reasoning" },
      { type: "text", text: "answer" },
      { type: "toolCall", id: "normalized", name: "lookup", arguments: {} },
    ]);
    expect(normalizeToolCallId).toHaveBeenCalledOnce();
  });

  test("keeps already-qualified history unchanged", () => {
    const requestModel = qualifyModelId("gateway-provider", model);
    const previous = assistant({ model: requestModel.id });
    const context = normalizeContext({ messages: [previous] });
    const request = withRequestModelId(context, model, requestModel);
    expect(request.messages[0]).toBe(previous);
    expect(
      (transformMessages(request.messages, requestModel)[0] as AssistantMessage)
        .content,
    ).toEqual(previous.content);
  });

  test.each([
    "google-generative-ai",
    "google-vertex",
    "bedrock-converse-stream",
  ] as const)("keeps context unchanged for path-embedding API %s", (api) => {
    const pathModel = { ...model, api };
    const context = normalizeContext({ messages: [assistant({ api })] });
    const requestModel = qualifyModelId("gateway-provider", pathModel);
    expect(requestModel).toBe(pathModel);
    expect(withRequestModelId(context, pathModel, requestModel)).toBe(context);
  });

  test("handles public model ids containing slashes", () => {
    const slashModel = { ...model, id: "org/model" };
    const context = normalizeContext({
      messages: [assistant({ model: slashModel.id })],
    });
    const requestModel = qualifyModelId("gateway-provider", slashModel);
    const request = withRequestModelId(context, slashModel, requestModel);
    expect((request.messages[0] as AssistantMessage).model).toBe(
      "gateway-provider/org/model",
    );
  });

  test("keeps empty contexts unchanged", () => {
    const context = normalizeContext({ messages: [] });
    expect(
      withRequestModelId(
        context,
        model,
        qualifyModelId("gateway-provider", model),
      ),
    ).toBe(context);
  });
});
