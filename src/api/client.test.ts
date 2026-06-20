import { afterEach, describe, expect, test, vi } from "vitest";
import { ApertureClient } from "./client";

describe("ApertureClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("parses /api/providers array response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            description: "Claude models",
            models: ["claude-3-5-sonnet"],
            compatibility: { anthropic_messages: true },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new ApertureClient("http://gateway.test/").providers(),
    ).resolves.toEqual([
      {
        id: "anthropic",
        name: "Anthropic",
        description: "Claude models",
        models: ["claude-3-5-sonnet"],
        compatibility: { anthropic_messages: true },
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://gateway.test/api/providers",
      expect.objectContaining({ method: "GET" }),
    );
  });

  test("parses /api/providers object response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          providers: {
            openrouter: {
              name: "OpenRouter",
              description: "",
              models: ["openai/gpt-5"],
              compatibility: { openai_chat: true },
            },
          },
        }),
      }),
    );

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

  test("parses provider base URLs from /aperture/config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          config: JSON.stringify({
            providers: {
              anthropic: {
                baseurl: "https://api.anthropic.com",
                name: "Anthropic",
              },
              openrouter: {
                baseurl: "https://openrouter.ai/api/",
                name: "OpenRouter",
              },
            },
          }),
        }),
      }),
    );

    await expect(
      new ApertureClient("http://gateway.test").providerBaseUrls(),
    ).resolves.toEqual(
      new Map([
        ["anthropic", "https://api.anthropic.com"],
        ["openrouter", "https://openrouter.ai/api/"],
      ]),
    );
  });
});
