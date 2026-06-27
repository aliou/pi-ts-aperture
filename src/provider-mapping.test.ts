import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import type { ApertureProvider, ApertureProviderConfigInfo } from "./api/types";
import { mapProxyProviders } from "./provider-mapping";

function localModel(
  provider: string,
  baseUrl: string,
  id = `${provider}-model`,
): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider,
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function gatewayProvider(id: string): ApertureProvider {
  return {
    id,
    name: id,
    description: "",
    models: [`${id}-model`],
    compatibility: { openai_chat: true },
  };
}

describe("mapProxyProviders", () => {
  test("matches local providers by gateway ID when config info is empty (non-admin grant)", () => {
    // Non-admin grants get 403 on /aperture/config, so providerConfigInfos()
    // returns an empty map. proxy matching must still work via IDs, which
    // come from /api/providers (accessible to non-admin grants).
    const localModels = [
      localModel("anthropic", "https://api.anthropic.com"),
      localModel("openai", "https://api.openai.com"),
      localModel("unmatched", "https://example.com"),
    ];
    const gatewayProviders = [
      gatewayProvider("anthropic"),
      gatewayProvider("openai"),
    ];

    const result = mapProxyProviders(
      localModels,
      new Map(),
      gatewayProviders,
      [],
    );

    expect(result.map((p) => p.id)).toEqual(["anthropic", "openai"]);
    // name resolved from gateway providers when config info is absent
    expect(result[0]).toMatchObject({ id: "anthropic", name: "anthropic" });
    // gateway model check defaults to on
    expect(result[0].shouldCheckGatewayModels).toBe(true);
  });

  test("returns nothing when no local provider matches a gateway provider ID", () => {
    const localModels = [localModel("unmatched", "https://example.com")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(
      localModels,
      new Map(),
      gatewayProviders,
      [],
    );

    expect(result).toEqual([]);
  });

  test("matches local providers by base URL when config info is populated (admin)", () => {
    const localModels = [
      localModel("anthropic", "https://api.anthropic.com/v1"),
      localModel("openrouter", "https://openrouter.ai/api"),
      localModel("excluded", "https://nowhere.example.com"),
    ];
    const providerInfos = new Map<string, ApertureProviderConfigInfo>([
      [
        "anthropic",
        {
          id: "anthropic",
          name: "Anthropic",
          baseUrl: "https://api.anthropic.com",
        },
      ],
      [
        "openrouter",
        {
          id: "openrouter",
          name: "OpenRouter",
          baseUrl: "https://openrouter.ai/api/",
        },
      ],
    ]);
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(
      localModels,
      providerInfos,
      gatewayProviders,
      [],
    );

    // Already sorted by id by collectLocalProviders.
    expect(result.map((p) => p.id)).toEqual(["anthropic", "openrouter"]);
    // Gateway provider name takes precedence over the config name when both exist.
    expect(result.find((p) => p.id === "anthropic")?.name).toBe("anthropic");
    // Config name used for the URL-matched provider that is not a gateway provider.
    expect(result.find((p) => p.id === "openrouter")?.name).toBe("OpenRouter");
    // No URL or ID match -> filtered out.
    expect(result.some((p) => p.id === "excluded")).toBe(false);
  });

  test("preserves existing shouldCheckGatewayModels setting", () => {
    const localModels = [localModel("anthropic", "https://api.anthropic.com")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, new Map(), gatewayProviders, [
      { id: "anthropic", shouldCheckGatewayModels: false },
    ]);

    expect(result[0].shouldCheckGatewayModels).toBe(false);
  });
});
