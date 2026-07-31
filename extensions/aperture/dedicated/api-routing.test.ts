import { describe, expect, test } from "vitest";
import { getBaseUrlForApi } from "./api-routing";

describe("getBaseUrlForApi", () => {
  const gatewayUrl = "http://ai-gateway.tail692491.ts.net";
  const baseUrl = `${gatewayUrl}/v1`;

  test("routes bedrock-converse-stream through the /bedrock surface, not /v1", () => {
    // Regression: falling through to the default branch here pointed
    // bedrock_converse models at Aperture's OpenAI-shaped /v1 base and
    // failed with a protocol error; Aperture's native Bedrock-compatible
    // surface lives at /bedrock.
    expect(
      getBaseUrlForApi("bedrock-converse-stream", gatewayUrl, baseUrl),
    ).toBe(`${gatewayUrl}/bedrock`);
  });

  test("keeps existing per-api base URL overrides", () => {
    expect(getBaseUrlForApi("anthropic-messages", gatewayUrl, baseUrl)).toBe(
      gatewayUrl,
    );
    expect(getBaseUrlForApi("google-generative-ai", gatewayUrl, baseUrl)).toBe(
      `${gatewayUrl}/v1beta`,
    );
    expect(getBaseUrlForApi("google-vertex", gatewayUrl, baseUrl)).toBe(
      `${gatewayUrl}/v1`,
    );
  });

  test("falls back to the generic baseUrl for other apis (e.g. openai-responses)", () => {
    expect(getBaseUrlForApi("openai-responses", gatewayUrl, baseUrl)).toBe(
      baseUrl,
    );
    expect(getBaseUrlForApi("openai-completions", gatewayUrl, baseUrl)).toBe(
      baseUrl,
    );
  });
});
