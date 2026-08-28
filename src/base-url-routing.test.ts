import { describe, expect, test } from "vitest";
import { embedsModelIdInPath, getBaseUrlForApi } from "./base-url-routing";

const GATEWAY = "https://aperture.example.ts.net";
const BASE_URL = `${GATEWAY}/v1`;

describe("getBaseUrlForApi", () => {
  test("routes Anthropic to the gateway root (Pi appends /v1/messages)", () => {
    expect(getBaseUrlForApi("anthropic-messages", GATEWAY, BASE_URL)).toBe(
      GATEWAY,
    );
  });

  test("routes Gemini to /v1beta", () => {
    expect(getBaseUrlForApi("google-generative-ai", GATEWAY, BASE_URL)).toBe(
      `${GATEWAY}/v1beta`,
    );
  });

  test("routes Vertex to /v1", () => {
    expect(getBaseUrlForApi("google-vertex", GATEWAY, BASE_URL)).toBe(
      `${GATEWAY}/v1`,
    );
  });

  test("routes Bedrock through the /bedrock surface, not /v1", () => {
    // Regression: bedrock_converse models fell through to the default branch
    // and were registered against the OpenAI-shaped /v1 base, but Aperture's
    // native Bedrock-compatible surface lives at /bedrock. This case is shared
    // by both proxy and dedicated modes.
    expect(getBaseUrlForApi("bedrock-converse-stream", GATEWAY, BASE_URL)).toBe(
      `${GATEWAY}/bedrock`,
    );
  });

  test("ignores the upstream base URL for fixed-path APIs", () => {
    // Anthropic / Gemini / Vertex / Bedrock map to a fixed gateway path
    // regardless of the upstream base URL; only the OpenAI-SDK default branch
    // consults it.
    expect(
      getBaseUrlForApi(
        "bedrock-converse-stream",
        GATEWAY,
        BASE_URL,
        "https://api.openai.com/v1",
      ),
    ).toBe(`${GATEWAY}/bedrock`);
    expect(
      getBaseUrlForApi(
        "google-generative-ai",
        GATEWAY,
        BASE_URL,
        "https://example.test/v4",
      ),
    ).toBe(`${GATEWAY}/v1beta`);
  });

  test("infers the gateway root for OpenAI-SDK APIs whose upstream has a non-/v1 version segment (Z.ai)", () => {
    expect(
      getBaseUrlForApi(
        "openai-completions",
        GATEWAY,
        BASE_URL,
        "https://api.z.ai/api/coding/paas/v4",
      ),
    ).toBe(GATEWAY);
  });

  test("keeps /v1 for OpenAI-SDK APIs whose upstream ends in /v1 (OpenAI, Groq)", () => {
    expect(
      getBaseUrlForApi(
        "openai-completions",
        GATEWAY,
        BASE_URL,
        "https://api.openai.com/v1",
      ),
    ).toBe(BASE_URL);
    expect(
      getBaseUrlForApi(
        "openai-responses",
        GATEWAY,
        BASE_URL,
        "https://api.groq.com/openai/v1",
      ),
    ).toBe(BASE_URL);
  });

  test("keeps /v1 when the upstream base URL is missing", () => {
    expect(getBaseUrlForApi("openai-responses", GATEWAY, BASE_URL)).toBe(
      BASE_URL,
    );
  });
});

describe("embedsModelIdInPath", () => {
  test("true for Gemini, Vertex, and Bedrock Converse", () => {
    expect(embedsModelIdInPath("google-generative-ai")).toBe(true);
    expect(embedsModelIdInPath("google-vertex")).toBe(true);
    expect(embedsModelIdInPath("bedrock-converse-stream")).toBe(true);
  });

  test("false for body-carried model APIs", () => {
    expect(embedsModelIdInPath("openai-completions")).toBe(false);
    expect(embedsModelIdInPath("openai-responses")).toBe(false);
    expect(embedsModelIdInPath("openai-codex-responses")).toBe(false);
    expect(embedsModelIdInPath("anthropic-messages")).toBe(false);
    expect(embedsModelIdInPath("mistral-conversations")).toBe(false);
  });
});
