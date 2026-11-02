import { describe, expect, test } from "vitest";
import {
  getApiForCompatibility,
  getSelectableApis,
  isSelectableApi,
} from "./api-selection";

describe("getSelectableApis", () => {
  test("returns APIs in auto-pick precedence order", () => {
    expect(
      getSelectableApis({
        openai_responses: true,
        anthropic_messages: true,
        openai_chat: true,
      }),
    ).toEqual(["openai-completions", "anthropic-messages", "openai-responses"]);
  });

  test("maps every dispatchable compatibility flag", () => {
    expect(
      getSelectableApis({
        openai_chat: true,
        anthropic_messages: true,
        openai_responses: true,
        gemini_generate_content: true,
        google_generate_content: true,
        bedrock_converse: true,
      }),
    ).toEqual([
      "openai-completions",
      "anthropic-messages",
      "openai-responses",
      "google-generative-ai",
      "google-vertex",
      "bedrock-converse-stream",
    ]);
  });

  test("excludes flags Pi cannot dispatch", () => {
    expect(
      getSelectableApis({
        google_raw_predict: true,
        bedrock_model_invoke: true,
        experimental_gemini_cli_vertex_compat: true,
      }),
    ).toEqual([]);
  });

  test("returns [] for a missing or empty map", () => {
    expect(getSelectableApis(undefined)).toEqual([]);
    expect(getSelectableApis({})).toEqual([]);
  });
});

describe("getApiForCompatibility", () => {
  test("picks the first selectable API", () => {
    expect(
      getApiForCompatibility({
        anthropic_messages: true,
        openai_chat: true,
      }),
    ).toBe("openai-completions");
  });

  test("falls back to chat completions when nothing is dispatchable", () => {
    expect(getApiForCompatibility(undefined)).toBe("openai-completions");
    expect(getApiForCompatibility({ google_raw_predict: true })).toBe(
      "openai-completions",
    );
  });
});

describe("isSelectableApi", () => {
  test("accepts APIs the gateway serves", () => {
    expect(
      isSelectableApi("anthropic-messages", { anthropic_messages: true }),
    ).toBe(true);
  });

  test("rejects APIs the gateway does not serve", () => {
    expect(isSelectableApi("anthropic-messages", { openai_chat: true })).toBe(
      false,
    );
    expect(isSelectableApi("openai-codex-responses", undefined)).toBe(false);
  });
});
