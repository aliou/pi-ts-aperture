import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import type { ApertureProvider } from "../../src/api/types";
import { mapDedicatedProviders, mapProxyProviders } from "./provider-mapping";

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
  test("matches local providers by gateway ID from /api/providers", () => {
    // /api/providers reflects the grant-scoped enabled providers, so proxy
    // matching is done exclusively by provider id. No base-URL matching is
    // performed.
    const localModels = [
      localModel("anthropic", "https://api.anthropic.com"),
      localModel("openai", "https://api.openai.com"),
      localModel("unmatched", "https://example.com"),
    ];
    const gatewayProviders = [
      gatewayProvider("anthropic"),
      gatewayProvider("openai"),
    ];

    const result = mapProxyProviders(localModels, gatewayProviders, []);

    expect(result.map((p) => p.id)).toEqual(["anthropic", "openai"]);
    // name resolved from gateway providers
    expect(result[0]).toMatchObject({ id: "anthropic", name: "anthropic" });
    // gateway model check defaults to on
    expect(result[0].shouldCheckGatewayModels).toBe(true);
  });

  test("returns nothing when no local provider matches a gateway provider ID", () => {
    const localModels = [localModel("unmatched", "https://example.com")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, gatewayProviders, []);

    expect(result).toEqual([]);
  });

  test("ignores local providers not present on the gateway", () => {
    const localModels = [
      localModel("anthropic", "https://api.anthropic.com/v1"),
      localModel("excluded", "https://nowhere.example.com"),
    ];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, gatewayProviders, []);

    expect(result.map((p) => p.id)).toEqual(["anthropic"]);
    expect(result.some((p) => p.id === "excluded")).toBe(false);
  });

  test("preserves existing shouldCheckGatewayModels setting", () => {
    const localModels = [localModel("anthropic", "https://api.anthropic.com")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, gatewayProviders, [
      { id: "anthropic", shouldCheckGatewayModels: false },
    ]);

    expect(result[0].shouldCheckGatewayModels).toBe(false);
  });

  test("preserves an existing api override", () => {
    const localModels = [localModel("openrouter", "https://openrouter.ai")];
    const gatewayProviders = [gatewayProvider("openrouter")];

    const result = mapProxyProviders(localModels, gatewayProviders, [
      {
        id: "openrouter",
        shouldCheckGatewayModels: false,
        api: "anthropic-messages",
      },
    ]);

    expect(result[0].api).toBe("anthropic-messages");
  });

  test("existing entries are enabled unless configured with enabled: false", () => {
    const localModels = [
      localModel("anthropic", "https://api.anthropic.com"),
      localModel("openai", "https://api.openai.com"),
      localModel("groq", "https://api.groq.com"),
    ];
    const gatewayProviders = [
      gatewayProvider("anthropic"),
      gatewayProvider("openai"),
      gatewayProvider("groq"),
    ];

    const result = mapProxyProviders(localModels, gatewayProviders, [
      { id: "anthropic", shouldCheckGatewayModels: false },
      {
        id: "openai",
        enabled: false,
        shouldCheckGatewayModels: false,
        api: "openai-responses",
      },
    ]);

    expect(Object.fromEntries(result.map((p) => [p.id, p.enabled]))).toEqual({
      anthropic: true,
      openai: false,
      groq: false,
    });
    // The disabled provider's other settings survive the round-trip.
    expect(result.find((p) => p.id === "openai")?.api).toBe("openai-responses");
  });
});

describe("mapDedicatedProviders", () => {
  test("preserves an existing api override", () => {
    const result = mapDedicatedProviders(
      [gatewayProvider("openrouter")],
      [{ id: "openrouter", enabled: true, api: "openai-responses" }],
    );

    expect(result[0].api).toBe("openai-responses");
  });
});
