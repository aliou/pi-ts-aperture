import { afterEach, describe, expect, test, vi } from "vitest";
import { ApertureClient, ApertureHttpError } from "./client";

describe("ApertureClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // helpers ---------------------------------------------------------------
  // providers() cross-references /v1/models, so every test that calls it
  // must stub both endpoints. `route` returns a fetch Response mock based on
  // the URL being requested.
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

  function models(...ids: string[]) {
    return { data: ids.map((id) => ({ id, object: "model" })) };
  }

  function modelWithPricing(id: string, pricing: Record<string, string>) {
    return { id, object: "model", pricing };
  }

  function providersArray(...providers: Record<string, unknown>[]) {
    return { providers };
  }

  function notOk(status: number, statusText: string) {
    return { ok: false, status, statusText, json: async () => ({}) };
  }

  // ----------------------------------------------------------------------
  // /api/providers array response
  // /v1/models exposes only `anthropic`'s model, so `unmatched` (disabled)
  // is dropped and `anthropic` survives with only its callable model.
  test("providers() filters out providers whose models are absent from /v1/models", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/providers")) {
        return providersArray(
          {
            id: "anthropic",
            name: "Anthropic",
            description: "Claude models",
            models: ["claude-3-5-sonnet", "claude-internal"],
            compatibility: { anthropic_messages: true },
          },
          {
            id: "unmatched",
            name: "Unmatched",
            description: "",
            models: ["unmatched-model"],
            compatibility: { openai_chat: true },
          },
        );
      }
      if (url.endsWith("/v1/models")) {
        return models("claude-3-5-sonnet");
      }
      return notOk(404, "Not Found");
    });

    await expect(
      new ApertureClient("http://gateway.test/").providers(),
    ).resolves.toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        description: "Claude models",
        // claude-internal is not in /v1/models -> intersected out
        models: ["claude-3-5-sonnet"],
        compatibility: { anthropic_messages: true },
        modelInfoById: { "claude-3-5-sonnet": { id: "claude-3-5-sonnet" } },
      },
    ]);
  });

  // /api/providers object response; only openrouter is enabled.
  test("providers() parses object response and keeps only enabled providers", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/providers")) {
        return {
          providers: {
            openrouter: {
              name: "OpenRouter",
              description: "",
              models: ["openai/gpt-5"],
              compatibility: { openai_chat: true },
            },
            disabled: {
              name: "Disabled",
              description: "",
              models: ["disabled-model"],
              compatibility: { openai_chat: true },
            },
          },
        };
      }
      if (url.endsWith("/v1/models")) {
        return models("openai/gpt-5");
      }
      return notOk(404, "Not Found");
    });

    await expect(
      new ApertureClient("http://gateway.test").providers(),
    ).resolves.toEqual([
      {
        id: "openrouter",
        name: "OpenRouter",
        description: "",
        models: ["openai/gpt-5"],
        compatibility: { openai_chat: true },
        modelInfoById: { "openai/gpt-5": { id: "openai/gpt-5" } },
      },
    ]);
  });

  // /v1/models failed or is unreachable -> providers() falls back to the
  // unfiltered /api/providers result.
  test("providers() falls back to unfiltered list when /v1/models is unreachable", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/providers")) {
        return providersArray({
          id: "anthropic",
          name: "Anthropic",
          description: "",
          models: ["claude-3-5-sonnet"],
          compatibility: { anthropic_messages: true },
        });
      }
      if (url.endsWith("/v1/models")) {
        return notOk(500, "Internal Server Error");
      }
      return notOk(404, "Not Found");
    });

    await expect(
      new ApertureClient("http://gateway.test").providers(),
    ).resolves.toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        description: "",
        models: ["claude-3-5-sonnet"],
        compatibility: { anthropic_messages: true },
      },
    ]);
  });

  test("providers() rejects with ApertureHttpError when /api/providers fails", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/providers"))
        return notOk(500, "Internal Server Error");
      if (url.endsWith("/v1/models")) return models();
      return notOk(404, "Not Found");
    });

    await expect(
      new ApertureClient("http://gateway.test").providers(),
    ).rejects.toBeInstanceOf(ApertureHttpError);
  });

  // /v1/models entries carry a `pricing` object; providers() should retain it
  // on `modelInfoById` so dedicated mode can build cost-aware model configs.
  test("providers() retains /v1/models pricing on modelInfoById", async () => {
    const pricing = {
      input: "0.00000100",
      input_cache_read: "0.00000010",
      input_cache_write: "0.00000125",
      input_cache_write_1h: "0.00000200",
      output: "0.00000500",
      web_search: "0.01000000",
    };
    mockFetch((url) => {
      if (url.endsWith("/api/providers")) {
        return providersArray({
          id: "synthetic",
          name: "Synthetic",
          description: "",
          models: ["syn:large:text"],
          compatibility: { openai_chat: true },
        });
      }
      if (url.endsWith("/v1/models")) {
        return { data: [modelWithPricing("syn:large:text", pricing)] };
      }
      return notOk(404, "Not Found");
    });

    const providers = await new ApertureClient(
      "http://gateway.test",
    ).providers();
    expect(providers[0].modelInfoById?.["syn:large:text"]).toEqual({
      id: "syn:large:text",
      pricing,
    });
  });

  // /v1/models entries carry `supported_endpoints`; providers() should retain
  // it on `modelInfoById` so dedicated mode can use it for per-model API
  // routing instead of the per-provider `compatibility` map.
  test("providers() retains /v1/models supported_endpoints on modelInfoById", async () => {
    mockFetch((url) => {
      if (url.endsWith("/api/providers")) {
        return providersArray({
          id: "synthetic",
          name: "Synthetic",
          description: "",
          models: ["hf:zai-org/GLM-5.2", "glm-5.2"],
          compatibility: {
            openai_chat: true,
            anthropic_messages: true,
            openai_responses: true,
          },
        });
      }
      if (url.endsWith("/v1/models")) {
        return {
          data: [
            {
              id: "hf:zai-org/GLM-5.2",
              object: "model",
              supported_endpoints: [
                "/v1/chat/completions",
                "/v1/messages",
                "/v1/responses",
              ],
              pricing: { input: "0.00000040", output: "0.00000175" },
            },
            {
              id: "glm-5.2",
              object: "model",
              supported_endpoints: ["/v1/chat/completions"],
              pricing: { input: "0.00000063", output: "0.00000198" },
            },
          ],
        };
      }
      return notOk(404, "Not Found");
    });

    const providers = await new ApertureClient(
      "http://gateway.test",
    ).providers();
    expect(providers[0].modelInfoById?.["hf:zai-org/GLM-5.2"]).toEqual({
      id: "hf:zai-org/GLM-5.2",
      pricing: { input: "0.00000040", output: "0.00000175" },
      supported_endpoints: [
        "/v1/chat/completions",
        "/v1/messages",
        "/v1/responses",
      ],
    });
    expect(providers[0].modelInfoById?.["glm-5.2"]).toEqual({
      id: "glm-5.2",
      pricing: { input: "0.00000063", output: "0.00000198" },
      supported_endpoints: ["/v1/chat/completions"],
    });
  });
});
