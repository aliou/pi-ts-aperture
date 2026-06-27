import { afterEach, describe, expect, test, vi } from "vitest";
import { ApertureClient, ApertureHttpError } from "./client";

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

  test("parses provider base URLs from commented /aperture/config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          config: `
            // Welcome to Aperture.
            {
              "providers": {
                "anthropic": { "baseurl": "https://api.anthropic.com" },
              },
            }
          `,
        }),
      }),
    );

    await expect(
      new ApertureClient("http://gateway.test").providerBaseUrls(),
    ).resolves.toEqual(new Map([["anthropic", "https://api.anthropic.com"]]));
  });

  // /aperture/config is admin-only on the gateway: a non-admin grant
  // (role:user) gets 403 while still being able to call /api/providers and
  // /v1/mcp. The client must not break proxy/dedicated flows for those users.

  test("providerConfigInfos() returns empty map on 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      }),
    );

    await expect(
      new ApertureClient("http://gateway.test").providerConfigInfos(),
    ).resolves.toEqual(new Map());
  });

  test("providerBaseUrls() returns empty map on 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      }),
    );

    await expect(
      new ApertureClient("http://gateway.test").providerBaseUrls(),
    ).resolves.toEqual(new Map());
  });

  test("providerConfigInfos() rethrows non-403 errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      }),
    );

    await expect(
      new ApertureClient("http://gateway.test").providerConfigInfos(),
    ).rejects.toBeInstanceOf(ApertureHttpError);
  });

  test("proxy provider fetch path resolves when /aperture/config is 403 but /api/providers is 200", async () => {
    // Mirrors how onboarding/settings fetch proxy providers:
    //   Promise.all([providerConfigInfos(), providers()])
    // A non-admin grant gets 403 on /aperture/config yet 200 on /api/providers,
    // so the combined fetch must not reject.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/aperture/config")) {
          return Promise.resolve({
            ok: false,
            status: 403,
            statusText: "Forbidden",
          });
        }
        return Promise.resolve({
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
      }),
    );

    const client = new ApertureClient("http://gateway.test");
    await expect(
      Promise.all([client.providerConfigInfos(), client.providers()]),
    ).resolves.toEqual([
      new Map(),
      [
        {
          id: "anthropic",
          name: "Anthropic",
          description: "Claude models",
          models: ["claude-3-5-sonnet"],
          compatibility: { anthropic_messages: true },
        },
      ],
    ]);
  });
});
