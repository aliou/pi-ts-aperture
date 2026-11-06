import type {
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
} from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { APERTURE_SYSTEM_ONE_API, classify } from "./system-one";

const model = {
  id: "acme/jev",
  api: APERTURE_SYSTEM_ONE_API,
  provider: "aperture",
  baseUrl: "https://ai.example.ts.net/v1",
  headers: {},
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, tiers: [] },
} as unknown as ClassifierModel<ClassifierApi>;

const context = {
  state: "",
  questions: { topic: { type: "choice", options: ["a", "b"] } },
} as unknown as ClassifierContext;

function fetchReturning(body: unknown, status: number) {
  return vi.fn(async () =>
    Response.json(body, { status }),
  ) as unknown as typeof fetch;
}

describe("classify error handling", () => {
  test("invalid response bodies become errors with billed usage", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchReturning(
        {
          answers: { topic: { type: "choice" } },
          usage: { input_tokens: 10, output_tokens: 2 },
        },
        200,
      ),
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBeTruthy();
    expect(result.usage?.totalTokens).toBe(12);
  });

  test("error responses surface the gateway's message", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchReturning({ detail: "quota exceeded" }, 402),
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe(
      "Aperture System One API returned 402: quota exceeded",
    );
  });

  test("bodies matching no schema report validation errors", async () => {
    const result = await classify(model, context, {
      apiKey: "-",
      fetch: fetchReturning({ unexpected: true }, 500),
    });

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBeTruthy();
  });
});
