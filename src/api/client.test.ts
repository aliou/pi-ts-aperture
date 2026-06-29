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
});
