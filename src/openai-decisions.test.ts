import type {
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
} from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { APERTURE_OPENAI_DECISIONS_API, classify } from "./openai-decisions";

const model = {
  id: "acme/jev",
  api: APERTURE_OPENAI_DECISIONS_API,
  provider: "aperture",
  baseUrl: "https://ai.example.ts.net/v1",
  headers: {},
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: [] },
} as unknown as ClassifierModel<ClassifierApi>;

const context = {
  state: { ticket: "billing" },
  questions: {
    topic: {
      type: "choice",
      instructions: "Classify the ticket.",
      criteria: { billing: "Invoices or refunds.", other: "Anything else." },
    },
    urgency: {
      type: "score",
      instructions: "Rate urgency.",
      criteria: ["low", "high"],
    },
    refund: {
      type: "bool",
      instructions: "Is this a refund request?",
      criteria: { true: "Refund.", false: "Not a refund." },
    },
  },
} as unknown as ClassifierContext;

function fetchOnly(body: unknown, status = 200) {
  return fetchReturning(body, status).fetch;
}

function fetchReturning(body: unknown, status = 200) {
  const calls: CapturedRequest[] = [];
  const fetchFn = vi.fn(async (_url: URL | string, init?: RequestInit) => {
    calls.push({ url: String(_url), init });
    return Response.json(body, { status });
  });
  return { fetch: fetchFn as unknown as typeof fetch, calls };
}

type CapturedRequest = { url: string; init?: RequestInit };

function choiceAnswer(name: string, choice: string) {
  return {
    type: "choice",
    name,
    choice,
    probabilities: [
      { value: choice, probability: 0.9 },
      { value: "other", probability: 0.1 },
    ],
    confidence: 0.8,
  };
}

describe("classify request format", () => {
  test("wires questions into the decisions protocol and posts to /decisions", async () => {
    const { fetch, calls } = fetchReturning({
      answers: [
        choiceAnswer("topic", "billing"),
        { type: "score", name: "urgency", score: 0.7, confidence: 0.9 },
        { type: "predicate", name: "refund", probability: 0.2 },
      ],
      usage: { input_tokens: 106, output_tokens: 0 },
    });
    await classify(model, context, { apiKey: "-", fetch });

    expect(calls[0].url).toBe("https://ai.example.ts.net/v1/decisions");
    const payload = JSON.parse(String(calls[0].init?.body));
    expect(payload.model).toBe("acme/jev");
    expect(payload.input).toBe(JSON.stringify(context.state));
    expect(payload.questions).toEqual([
      {
        type: "choice",
        name: "topic",
        instructions: "Classify the ticket.",
        choices: [
          { value: "billing", description: "Invoices or refunds." },
          { value: "other", description: "Anything else." },
        ],
      },
      {
        type: "score",
        name: "urgency",
        instructions: "Rate urgency.",
        levels: [{ label: "low" }, { label: "high" }],
      },
      {
        type: "predicate",
        name: "refund",
        instructions:
          "Is this a refund request?\n\nTrue means: Refund.\nFalse means: Not a refund.",
      },
    ]);
  });

  test("sends images as one user message of data URLs", async () => {
    const imageContext = {
      state: { page: "checkout" },
      images: [{ mimeType: "image/png", data: "aGVsbG8=" }],
      questions: {
        visible: {
          type: "bool",
          instructions: "Is a paywall visible?",
          criteria: { true: "Yes.", false: "No." },
        },
      },
    } as unknown as ClassifierContext;

    const { fetch, calls } = fetchReturning({
      answers: [{ type: "predicate", name: "visible", probability: 1 }],
    });
    await classify(model, imageContext, { apiKey: "-", fetch });

    const payload = JSON.parse(String(calls[0].init?.body));
    expect(payload.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: JSON.stringify(imageContext.state) },
          { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
        ],
      },
    ]);
  });
});

describe("classify answer mapping", () => {
  test("maps choice, score, and predicate answers", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchOnly({
        answers: [
          choiceAnswer("topic", "billing"),
          { type: "score", name: "urgency", score: 0.7, confidence: 0.9 },
          { type: "predicate", name: "refund", probability: 0.2 },
        ],
        usage: { input_tokens: 106, output_tokens: 0 },
      }),
    });

    expect(result.stopReason).toBe("stop");
    expect(result.answers.topic).toEqual({
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.9, other: 0.1 },
      confidence: 0.8,
    });
    expect(result.answers.urgency).toEqual({
      type: "score",
      score: 0.7,
      confidence: 0.9,
    });
    expect(result.answers.refund).toEqual({
      type: "bool",
      probability: 0.2,
    });
    expect(result.usage?.totalTokens).toBe(106);
  });

  test("a missing answer becomes an error", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchOnly({ answers: [choiceAnswer("topic", "billing")] }),
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("urgency");
  });

  test("a refusal becomes an error", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchOnly({
        answers: [
          { type: "refusal", name: "topic" },
          { type: "score", name: "urgency", score: 0.1, confidence: 1 },
          { type: "predicate", name: "refund", probability: 0 },
        ],
      }),
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("refused to answer topic");
  });
});

describe("classify error handling", () => {
  test("ignores extra usage fields the gateway reports", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchOnly({
        answers: [
          choiceAnswer("topic", "billing"),
          { type: "score", name: "urgency", score: 0.5, confidence: 1 },
          { type: "predicate", name: "refund", probability: 0.1 },
        ],
        usage: {
          input_tokens: 106,
          output_tokens: 0,
          total_tokens: 106,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
    });

    expect(result.stopReason).toBe("stop");
    expect(result.usage?.totalTokens).toBe(106);
  });

  test("forwards cached and cache-write input tokens", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchOnly({
        answers: [
          choiceAnswer("topic", "billing"),
          { type: "score", name: "urgency", score: 0.5, confidence: 1 },
          { type: "predicate", name: "refund", probability: 0.1 },
        ],
        usage: {
          input_tokens: 20156,
          output_tokens: 0,
          total_tokens: 20156,
          input_tokens_details: {
            cached_tokens: 20005,
            cache_write_tokens: 0,
          },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      }),
    });

    expect(result.stopReason).toBe("stop");
    expect(result.usage?.input).toBe(20156);
    expect(result.usage?.cacheRead).toBe(20005);
    expect(result.usage?.cacheWrite).toBe(0);
    expect(result.usage?.totalTokens).toBe(20156);
  });

  test("error responses surface the gateway's message", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchOnly(
        { error: { message: "model not found", type: "x", code: "y" } },
        404,
      ),
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe(
      "Aperture OpenAI Decisions API returned 404: model not found",
    );
  });

  test("invalid response bodies become errors with billed usage", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchOnly({
        answers: [{ type: "choice" }],
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBeTruthy();
    expect(result.usage?.totalTokens).toBe(12);
  });

  test("bodies matching no schema report validation errors", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchOnly({ unexpected: true }, 500),
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBeTruthy();
  });

  test("reports the unsupported classifier api", async () => {
    const result = await classify(
      { ...model, api: "typesafe-system-one" } as never,
      context,
      { apiKey: "-", fetch: fetchOnly({ answers: [] }) },
    );

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("Unsupported classifier API");
  });
});
