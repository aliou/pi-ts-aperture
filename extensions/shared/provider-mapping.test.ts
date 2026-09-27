import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import type { ApertureProvider } from "../../src/api/types";
import {
  mapDedicatedProviders,
  mapGatewayProxyProviders,
  mapProxyProviders,
} from "./provider-mapping";

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
  test("matches local providers by gateway id", () => {
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

    expect(result.map((p) => p.id)).toEqual([
      "anthropic",
      "openai",
      "unmatched",
    ]);
    // name resolved from gateway providers
    expect(result[0]).toMatchObject({ id: "anthropic", name: "anthropic" });
    // gateway model check defaults to on
    expect(result[0].shouldCheckGatewayModels).toBe(true);
    expect(result[2]).toMatchObject({ gatewayId: undefined, enabled: false });
  });

  test("shows unmatched local providers as unrouted", () => {
    const localModels = [localModel("unmatched", "https://example.com")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, gatewayProviders, []);

    expect(result).toMatchObject([
      { id: "unmatched", gatewayId: undefined, enabled: false },
    ]);
  });

  test("includes local providers not present on the gateway", () => {
    const localModels = [
      localModel("anthropic", "https://api.anthropic.com/v1"),
      localModel("excluded", "https://nowhere.example.com"),
    ];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, gatewayProviders, []);

    expect(result.map((p) => p.id)).toEqual(["anthropic", "excluded"]);
    expect(result.find((p) => p.id === "excluded")?.gatewayId).toBeUndefined();
  });

  test("preserves existing shouldCheckGatewayModels setting", () => {
    const localModels = [localModel("anthropic", "https://api.anthropic.com")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, gatewayProviders, [
      {
        id: "anthropic",
        gatewayId: "anthropic",
        shouldCheckGatewayModels: false,
      },
    ]);

    expect(result[0].shouldCheckGatewayModels).toBe(false);
  });

  test("preserves an existing api override", () => {
    const localModels = [localModel("openrouter", "https://openrouter.ai")];
    const gatewayProviders = [gatewayProvider("openrouter")];

    const result = mapProxyProviders(localModels, gatewayProviders, [
      {
        id: "openrouter",
        gatewayId: "openrouter",
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
      {
        id: "anthropic",
        gatewayId: "anthropic",
        shouldCheckGatewayModels: false,
      },
      {
        id: "openai",
        gatewayId: "openai",
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

  test("maps entry-only targets and excludes aperture", () => {
    const catalog = [
      gatewayProvider("anthropic-oauth"),
      gatewayProvider("openai"),
      gatewayProvider("aperture"),
    ];
    const rows = mapProxyProviders(
      [
        localModel("anthropic", "https://example.com"),
        localModel("aperture", "https://example.com"),
      ],
      catalog,
      [{ id: "anthropic", gatewayId: "anthropic-oauth", enabled: false }],
    );
    expect(rows).toMatchObject([
      {
        id: "anthropic",
        gatewayId: "anthropic-oauth",
        name: "anthropic-oauth",
        enabled: false,
      },
    ]);
    const gatewayRows = mapGatewayProxyProviders(
      [
        localModel("anthropic", "https://example.com"),
        localModel("aperture", "https://example.com"),
      ],
      catalog,
      [{ id: "anthropic", gatewayId: "anthropic-oauth", enabled: false }],
    );
    expect(gatewayRows.map((row) => row.provider.id)).toEqual([
      "anthropic-oauth",
      "openai",
    ]);
    expect(gatewayRows[0].pairedLocalIds).toEqual(["anthropic"]);
    expect(gatewayRows[1].pairedLocalIds).toEqual([]);
  });

  test("gateway rows are bounded by the catalog, not the local provider count", () => {
    const gatewayRows = mapGatewayProxyProviders(
      [
        localModel("openai", "https://example.com"),
        localModel("unused-one", "https://example.com"),
        localModel("unused-two", "https://example.com"),
      ],
      [gatewayProvider("openai"), gatewayProvider("unmatched")],
      [],
    );
    expect(gatewayRows).toMatchObject([
      {
        provider: { id: "openai" },
        exactLocalId: "openai",
        pairedLocalIds: [],
      },
      {
        provider: { id: "unmatched" },
        exactLocalId: undefined,
        pairedLocalIds: [],
      },
    ]);
  });

  test("sorts gateway rows by display name", () => {
    const rows = mapGatewayProxyProviders(
      [],
      [
        { ...gatewayProvider("z"), name: "Alpha" },
        { ...gatewayProvider("a"), name: "Zeta" },
        { ...gatewayProvider("m"), name: "Middle" },
      ],
      [],
    );
    expect(rows.map((row) => row.provider.id)).toEqual(["z", "m", "a"]);
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

  test("excludes passthrough (requires_client_auth) providers", () => {
    const result = mapDedicatedProviders(
      [
        gatewayProvider("openrouter"),
        { ...gatewayProvider("codex"), requires_client_auth: true },
      ],
      [],
    );

    expect(result.map((p) => p.id)).toEqual(["openrouter"]);
  });
});
