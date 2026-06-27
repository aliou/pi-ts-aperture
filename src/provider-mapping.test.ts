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

  // --- merge / manual mapping (non-admin escape hatch) ---

  test("manual mapping survives when auto-match cannot find it (non-admin, mismatched id)", () => {
    // Non-admin: providerInfos is empty (403 on /aperture/config). The Pi
    // provider id does not match any gateway provider id, so auto-match would
    // drop it. A persisted manual mapping (apertureProviderId set) must be
    // preserved so it is not clobbered on the next submenu reopen.
    const localModels = [localModel("openrouter", "https://openrouter.ai/api")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, new Map(), gatewayProviders, [
      { id: "openrouter", apertureProviderId: "anthropic" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "openrouter",
      apertureProviderId: "anthropic",
      matchedAutomatically: false,
      existsLocally: true,
    });
    // name resolved from the gateway provider the mapping points at
    expect(result[0].name).toBe("anthropic");
  });

  test("persisted apertureProviderId overrides the auto match", () => {
    // `foo` would auto-match gateway id `foo`, but the persisted config maps it
    // to `bar`. The override is honored rather than silently dropped.
    const localModels = [localModel("foo", "https://example.com")];
    const gatewayProviders = [gatewayProvider("foo"), gatewayProvider("bar")];

    const result = mapProxyProviders(localModels, new Map(), gatewayProviders, [
      { id: "foo", apertureProviderId: "bar" },
    ]);

    expect(result[0]).toMatchObject({
      id: "foo",
      apertureProviderId: "bar",
      matchedAutomatically: true,
    });
    expect(result[0].name).toBe("bar");
  });

  test("stale manual mapping (local Pi provider gone) is kept and flagged", () => {
    // No local model for `deleted`; the mapping must not be silently dropped.
    const localModels: Model<Api>[] = [];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, new Map(), gatewayProviders, [
      { id: "deleted", apertureProviderId: "anthropic" },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "deleted",
      apertureProviderId: "anthropic",
      matchedAutomatically: false,
      existsLocally: false,
    });
    expect(result[0].baseUrls).toEqual([]);
  });

  test("dedupes persisted entries by Pi provider id (last wins)", () => {
    const localModels = [localModel("openrouter", "https://openrouter.ai/api")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const result = mapProxyProviders(localModels, new Map(), gatewayProviders, [
      {
        id: "openrouter",
        apertureProviderId: "openai",
        shouldCheckGatewayModels: false,
      },
      {
        id: "openrouter",
        apertureProviderId: "anthropic",
        shouldCheckGatewayModels: true,
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "openrouter",
      apertureProviderId: "anthropic",
      shouldCheckGatewayModels: true,
      matchedAutomatically: false,
    });
  });

  test("auto-match by base URL assigns the specific matching gateway provider id", () => {
    // Local provider `openrouter` matches the `openai-compatible` config entry
    // by base URL (admin). The mapping must point at `openai-compatible`, not
    // the local `openrouter` id, and stay auto-matched.
    const localModels = [localModel("openrouter", "https://openrouter.ai/api")];
    const providerInfos = new Map<string, ApertureProviderConfigInfo>([
      [
        "openai-compatible",
        {
          id: "openai-compatible",
          name: "OpenAI Compatible",
          baseUrl: "https://openrouter.ai/api/",
        },
      ],
    ]);
    const gatewayProviders = [gatewayProvider("openai-compatible")];

    const result = mapProxyProviders(
      localModels,
      providerInfos,
      gatewayProviders,
      [],
    );

    expect(result[0]).toMatchObject({
      id: "openrouter",
      apertureProviderId: "openai-compatible",
      matchedAutomatically: true,
    });
    // Gateway provider name takes precedence over the config-info name.
    expect(result[0].name).toBe("openai-compatible");
  });
});
