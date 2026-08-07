import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import {
  fetchModelsDevCatalog,
  type ModelsDevCatalog,
  resolveModelMetadata,
} from "./index";

function registryModel(overrides: Partial<Model<Api>>): Model<Api> {
  return {
    id: "model-x",
    name: "Model X",
    api: "openai-completions",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2.5 },
    contextWindow: 400_000,
    maxTokens: 64_000,
    ...overrides,
  } as Model<Api>;
}

const catalog: ModelsDevCatalog = {
  zai: {
    models: {
      "glm-5": {
        name: "GLM-5",
        reasoning: true,
        modalities: { input: ["text", "image", "video"], output: ["text"] },
        limit: { context: 200_000, output: 32_768 },
        cost: { input: 0.95, output: 2.55, cache_read: 0.2 },
      },
    },
  },
  openrouter: {
    models: {
      "glm-5": {
        reasoning: true,
        limit: { context: 131_072, output: 16_384 },
        cost: { input: 0.5, output: 1.5 },
      },
    },
  },
  mistral: {
    models: {
      "unique-model": {
        reasoning: false,
        modalities: { input: ["text"] },
        limit: { context: 32_000, output: 8_000 },
        cost: { input: 0.1, output: 0.3 },
      },
    },
  },
};

describe("resolveModelMetadata / models.dev", () => {
  test("provider-exact match copies capabilities and cost", () => {
    const metadata = resolveModelMetadata("zai", "glm-5", {
      modelsDev: catalog,
    });

    expect(metadata.name).toBe("GLM-5");
    expect(metadata.reasoning).toBe(true);
    expect(metadata.input).toEqual(["text", "image"]); // video filtered out
    expect(metadata.contextWindow).toBe(200_000);
    expect(metadata.maxTokens).toBe(32_768);
    expect(metadata.cost).toEqual({
      input: 0.95,
      output: 2.55,
      cacheRead: 0.2,
      cacheWrite: 0,
    });
  });

  test("unique model-id fallback copies capabilities but not cost", () => {
    const metadata = resolveModelMetadata("custom-provider", "unique-model", {
      modelsDev: catalog,
    });

    expect(metadata.contextWindow).toBe(32_000);
    expect(metadata.maxTokens).toBe(8_000);
    expect(metadata.reasoning).toBe(false);
    expect(metadata.cost).toBeUndefined();
  });

  test("ambiguous model-id fallback matches nothing", () => {
    // glm-5 exists under both zai and openrouter with different limits.
    const metadata = resolveModelMetadata("custom-provider", "glm-5", {
      modelsDev: catalog,
    });

    expect(metadata).toEqual({});
  });

  test("unknown model resolves to empty metadata", () => {
    const metadata = resolveModelMetadata("zai", "nope", {
      modelsDev: catalog,
    });
    expect(metadata).toEqual({});
  });
});

describe("resolveModelMetadata / Pi registry", () => {
  test("provider-exact match copies everything including thinkingLevelMap and compat", () => {
    const model = registryModel({
      provider: "openai",
      id: "gpt-5",
      thinkingLevelMap: {
        off: null,
        low: "low",
      } as Model<Api>["thinkingLevelMap"],
      compat: { supportsStore: false } as Model<Api>["compat"],
    });
    const metadata = resolveModelMetadata("openai", "gpt-5", {
      registryModels: [model],
    });

    expect(metadata.name).toBe("Model X");
    expect(metadata.reasoning).toBe(true);
    expect(metadata.input).toEqual(["text", "image"]);
    expect(metadata.contextWindow).toBe(400_000);
    expect(metadata.maxTokens).toBe(64_000);
    expect(metadata.cost).toEqual({
      input: 2,
      output: 8,
      cacheRead: 0.5,
      cacheWrite: 2.5,
    });
    expect(metadata.thinkingLevelMap).toEqual({ off: null, low: "low" });
    expect(metadata.compat).toEqual({ supportsStore: false });
  });

  test("model-id fallback copies capabilities but not cost; copies only model-intrinsic compat", () => {
    const model = registryModel({
      provider: "openrouter",
      id: "gpt-5",
      compat: {
        supportsStore: false,
        supportsDeveloperRole: false,
        maxTokensField: "max_tokens",
        supportsLongCacheRetention: false,
      } as Model<Api>["compat"],
    });
    const metadata = resolveModelMetadata("my-openai-alias", "gpt-5", {
      registryModels: [model],
    });

    expect(metadata.contextWindow).toBe(400_000);
    expect(metadata.input).toEqual(["text", "image"]);
    expect(metadata.cost).toBeUndefined();
    // Intrinsic fields (model-dictated) are copied on a model-id fallback...
    expect(metadata.compat?.supportsDeveloperRole).toBe(false);
    expect(metadata.compat?.maxTokensField).toBe("max_tokens");
    // ...endpoint-specific fields are not.
    expect(metadata.compat?.supportsStore).toBeUndefined();
    expect(metadata.compat?.supportsLongCacheRetention).toBeUndefined();
  });

  test("model-id fallback with endpoint-only compat copies nothing", () => {
    const model = registryModel({
      provider: "openrouter",
      id: "gpt-5",
      compat: { supportsStore: false } as Model<Api>["compat"],
    });
    const metadata = resolveModelMetadata("my-openai-alias", "gpt-5", {
      registryModels: [model],
    });

    expect(metadata.compat).toBeUndefined();
  });

  test("zero-cost registry match does not set cost", () => {
    const model = registryModel({
      provider: "openai",
      id: "gpt-5",
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
    const metadata = resolveModelMetadata("openai", "gpt-5", {
      registryModels: [model],
    });

    expect(metadata.cost).toBeUndefined();
  });
});

describe("resolveModelMetadata / precedence", () => {
  test("registry wins over models.dev", () => {
    const model = registryModel({
      provider: "zai",
      id: "glm-5",
      contextWindow: 128_000,
      maxTokens: 96_000,
      input: ["text"],
      cost: { input: 0.6, output: 2.2, cacheRead: 0.11, cacheWrite: 0 },
    });
    const metadata = resolveModelMetadata("zai", "glm-5", {
      registryModels: [model],
      modelsDev: catalog,
    });

    expect(metadata.contextWindow).toBe(128_000);
    expect(metadata.maxTokens).toBe(96_000);
    expect(metadata.input).toEqual(["text"]);
    expect(metadata.cost?.input).toBe(0.6);
  });

  test("models.dev fills when registry has no match", () => {
    const model = registryModel({ provider: "openai", id: "gpt-5" });
    const metadata = resolveModelMetadata("zai", "glm-5", {
      registryModels: [model],
      modelsDev: catalog,
    });

    expect(metadata.contextWindow).toBe(200_000);
    expect(metadata.cost?.input).toBe(0.95);
  });
});

describe("fetchModelsDevCatalog", () => {
  test("returns the parsed catalog", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ zai: { models: {} } }), { status: 200 }),
    );
    const result = await fetchModelsDevCatalog({ fetchFn });
    expect(result).toEqual({ zai: { models: {} } });
  });

  test("returns null on HTTP error", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 }));
    const result = await fetchModelsDevCatalog({ fetchFn });
    expect(result).toBeNull();
  });

  test("returns null on network failure", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("offline");
    });
    const result = await fetchModelsDevCatalog({ fetchFn });
    expect(result).toBeNull();
  });

  test("returns null on non-object body", async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify([1, 2]), { status: 200 }),
    );
    const result = await fetchModelsDevCatalog({ fetchFn });
    expect(result).toBeNull();
  });
});
