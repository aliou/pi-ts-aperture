import { afterEach, describe, expect, test, vi } from "vitest";
import { ApertureClient, ApertureHttpError } from "./client";

describe("ApertureClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(route: (url: string) => unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const payload = route(url);
        if (payload instanceof Error) return Promise.reject(payload);
        if (payload && typeof payload === "object" && "ok" in payload) {
          return Promise.resolve(payload);
        }
        return Promise.resolve({ ok: true, json: async () => payload });
      }),
    );
  }

  function model(
    id: string,
    provider: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) {
    return { id, object: "model", metadata: { provider }, ...extra };
  }

  function notOk(status: number, statusText: string) {
    return { ok: false, status, statusText, json: async () => ({}) };
  }

  test("providers() groups /v1/models entries by provider metadata", async () => {
    mockFetch((url) => {
      if (url.endsWith("/v1/models")) {
        return {
          data: [
            model(
              "claude-sonnet-4",
              { id: "anthropic", name: "Anthropic" },
              { supported_endpoints: ["/v1/messages"] },
            ),
            model(
              "gpt-5",
              { id: "openai", name: "OpenAI", requires_client_auth: true },
              {
                supported_endpoints: ["/v1/chat/completions", "/v1/responses"],
              },
            ),
            model(
              "gpt-5-mini",
              { id: "openai", name: "OpenAI", requires_client_auth: true },
              { supported_endpoints: ["/v1/chat/completions"] },
            ),
          ],
        };
      }
      return notOk(404, "Not Found");
    });

    await expect(
      new ApertureClient("http://gateway.test/").providers(),
    ).resolves.toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        description: "",
        models: ["claude-sonnet-4"],
        compatibility: { anthropic_messages: true },
        requires_client_auth: false,
        modelInfoById: { "claude-sonnet-4": { id: "claude-sonnet-4" } },
      },
      {
        id: "openai",
        name: "OpenAI",
        description: "",
        models: ["gpt-5", "gpt-5-mini"],
        compatibility: { openai_chat: true, openai_responses: true },
        requires_client_auth: true,
        modelInfoById: {
          "gpt-5": { id: "gpt-5" },
          "gpt-5-mini": { id: "gpt-5-mini" },
        },
      },
    ]);
  });

  test("providers() maps Gemini endpoints to gemini_generate_content", async () => {
    mockFetch((url) => {
      if (url.endsWith("/v1/models")) {
        return {
          data: [
            model(
              "gemini-2.5-pro",
              { id: "google", name: "Google AI Studio" },
              {
                supported_endpoints: [
                  "/v1beta/models/{model}:generateContent",
                  "/v1beta/models/{model}:streamGenerateContent",
                ],
              },
            ),
          ],
        };
      }
      return notOk(404, "Not Found");
    });

    const providers = await new ApertureClient(
      "http://gateway.test",
    ).providers();
    expect(providers[0].compatibility).toEqual({
      gemini_generate_content: true,
    });
  });

  test("providers() retains pricing on modelInfoById", async () => {
    const pricing = { input: "0.00000100", output: "0.00000500" };
    mockFetch((url) => {
      if (url.endsWith("/v1/models")) {
        return {
          data: [
            model(
              "syn:large:text",
              { id: "synthetic", name: "Synthetic" },
              { pricing, supported_endpoints: ["/v1/chat/completions"] },
            ),
          ],
        };
      }
      return notOk(404, "Not Found");
    });

    const providers = await new ApertureClient(
      "http://gateway.test",
    ).providers();
    expect(providers[0].modelInfoById["syn:large:text"]).toEqual({
      id: "syn:large:text",
      pricing,
    });
  });

  test("providers() skips entries without provider metadata", async () => {
    mockFetch((url) => {
      if (url.endsWith("/v1/models")) {
        return {
          data: [
            { id: "orphan", object: "model" },
            model("gpt-5", { id: "openai", name: "OpenAI" }),
          ],
        };
      }
      return notOk(404, "Not Found");
    });

    const providers = await new ApertureClient(
      "http://gateway.test",
    ).providers();
    expect(providers.map((p) => p.id)).toEqual(["openai"]);
    expect(providers[0].models).toEqual(["gpt-5"]);
  });

  test("providers() rejects with ApertureHttpError when /v1/models fails", async () => {
    mockFetch((url) => {
      if (url.endsWith("/v1/models")) {
        return notOk(500, "Internal Server Error");
      }
      return notOk(404, "Not Found");
    });

    await expect(
      new ApertureClient("http://gateway.test").providers(),
    ).rejects.toBeInstanceOf(ApertureHttpError);
  });
});
