import type {
  Api,
  Model,
  ModelsStoreEntry,
  Provider,
  ProviderModelsStore,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ApertureProvider } from "../../../src/api/types";
import type { ModelsDevCatalog } from "../../../src/model-metadata";

// vi.hoisted gives access to the mock fns inside hoisted vi.mock factories
// (which run before top-level bindings are initialized).
const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  client: vi.fn(),
  providers: vi.fn<(signal?: AbortSignal) => Promise<ApertureProvider[]>>(),
  fetchModelsDevCatalog: vi.fn<() => Promise<ModelsDevCatalog | null>>(
    async () => null,
  ),
}));

// Mock the config loader so the runtime never touches real config.
vi.mock("../../../src/shared/config/loader", () => ({
  configLoader: {
    getConfig: mocks.getConfig,
  },
}));

// Mock the ApertureClient so refresh never hits the network. The constructor
// implementation is re-applied in beforeEach because vitest's mockReset:true
// wipes implementations between tests.
vi.mock("../../../src/api/client", () => ({
  ApertureClient: mocks.client,
}));

// Mock the models.dev fetch; individual tests provide a catalog when needed.
vi.mock("../../../src/model-metadata", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/model-metadata")>();
  return {
    ...original,
    fetchModelsDevCatalog: mocks.fetchModelsDevCatalog,
  };
});

const { configLoader } = await import("../../../src/shared/config/loader");
const { registerDedicatedProvider, reconcileDedicatedProvider } = await import(
  "./runtime"
);

const getConfig = vi.mocked(configLoader.getConfig);
const clientMock = vi.mocked(mocks.client);
const providersMock = vi.mocked(mocks.providers);
const fetchModelsDevCatalogMock = vi.mocked(mocks.fetchModelsDevCatalog);

const GATEWAY = "http://gateway.test";

function dedicatedConfig(enabled = true, providers: unknown[] = []) {
  return {
    baseUrl: GATEWAY,
    onboardingDone: true,
    onboarding: { enabled: false },
    proxy: { enabled: false, upstreamProviders: [] },
    dedicated: { enabled, providers },
  };
}

function gatewayProvider(id: string, models: string[]): ApertureProvider {
  return {
    id,
    name: id,
    models,
    compatibility: { openai_chat: true },
  };
}

function gatewayProviderWithPricing(
  id: string,
  modelId: string,
  pricing: Record<string, string>,
): ApertureProvider {
  return {
    ...gatewayProvider(id, [modelId]),
    modelInfoById: { [modelId]: { id: modelId, pricing } },
  };
}

function nativeModel(
  provider: string,
  id: string,
  baseUrl: string,
  overrides: Partial<Model<Api>> = {},
): Model<Api> {
  return {
    provider,
    id,
    api: "openai-completions",
    baseUrl,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 0,
    maxTokens: 0,
    ...overrides,
  } as Model<Api>;
}

/** In-memory ProviderModelsStore for driving refreshModels. */
function memoryStore(initial?: ModelsStoreEntry): ProviderModelsStore & {
  entry: ModelsStoreEntry | undefined;
} {
  const store = {
    entry: initial,
    read: async () => store.entry,
    write: async (entry: ModelsStoreEntry) => {
      store.entry = entry;
    },
    delete: async () => {
      store.entry = undefined;
    },
  };
  return store;
}

interface DedicatedPublication {
  persist?: ModelsStoreEntry | null;
  update?: () => void;
}

/** Register the provider against a fake pi and return the native Provider. */
function register(getModels: () => Model<Api>[] = () => []): Provider | null {
  const registerProvider = vi.fn();
  registerDedicatedProvider({ registerProvider }, getModels);
  const provider = registerProvider.mock.calls.at(-1)?.[0] as
    | Provider
    | undefined;
  return provider ?? null;
}

/**
 * Drive refreshModels the way Pi does: a refresh context whose publish
 * applies the persist entry to the memory store and runs update hooks, so the
 * provider's live list reflects the catalog after the call.
 */
async function refresh(
  provider: Provider | null,
  store: ProviderModelsStore,
  allowNetwork: boolean,
): Promise<readonly Model<Api>[]> {
  if (!provider?.refreshModels) throw new Error("no refreshModels on provider");
  const tracked = store as ProviderModelsStore & {
    entry: ModelsStoreEntry | undefined;
  };
  const context = {
    allowNetwork,
    signal: new AbortController().signal,
    get stored() {
      return tracked.entry;
    },
    publish: async (publication: DedicatedPublication) => {
      if (publication.persist) await store.write(publication.persist);
      publication.update?.();
      return true;
    },
  } as unknown as RefreshModelsContext;
  await provider.refreshModels(context);
  return provider.getModels();
}

beforeEach(() => {
  getConfig.mockReturnValue(dedicatedConfig());
  // biome-ignore lint/complexity/useArrowFunction: must be constructible (new ApertureClient)
  clientMock.mockImplementation(function () {
    return { providers: providersMock };
  });
  providersMock.mockReset();
  fetchModelsDevCatalogMock.mockReset();
  fetchModelsDevCatalogMock.mockResolvedValue(null);
});

describe("registerDedicatedProvider", () => {
  test("registers the provider as a native Provider", async () => {
    const provider = register();

    expect(provider).not.toBeNull();
    expect(provider?.id).toBe("aperture");
    expect(provider?.baseUrl).toBe(`${GATEWAY}/v1`);
    expect(provider?.getModels()).toEqual([]);
    expect(provider?.stream).toBeTypeOf("function");
    expect(provider?.streamSimple).toBeTypeOf("function");
    expect(provider?.refreshModels).toBeTypeOf("function");
  });

  test("owns gateway auth: always configured, placeholder api key", async () => {
    const input = {
      ctx: { env: async () => undefined, fileExists: async () => false },
      signal: new AbortController().signal,
    };
    const auth = register()?.auth.apiKey;

    expect(auth).toBeDefined();
    // No user key exists for the gateway provider, so check always passes.
    await expect(auth?.check?.(input)).resolves.toMatchObject({
      type: "api_key",
    });
    await expect(auth?.resolve(input)).resolves.toMatchObject({
      auth: { apiKey: "-" },
    });
    // Ambient-only: no interactive login for a gateway-authenticated provider.
    expect(auth?.login).toBeUndefined();
  });

  test("no-ops when dedicated is disabled", () => {
    getConfig.mockReturnValue(dedicatedConfig(false));
    expect(register()).toBeNull();
  });

  test("no-ops when baseUrl is unset", () => {
    getConfig.mockReturnValue({ ...dedicatedConfig(), baseUrl: "" });
    expect(register()).toBeNull();
  });
});

describe("reconcileDedicatedProvider", () => {
  test("unregisters when dedicated is disabled", () => {
    getConfig.mockReturnValue(dedicatedConfig(false));
    const registerProvider = vi.fn();
    const unregisterProvider = vi.fn();

    reconcileDedicatedProvider(
      { registerProvider, unregisterProvider },
      () => [],
    );

    expect(unregisterProvider).toHaveBeenCalledWith("aperture");
    expect(registerProvider).not.toHaveBeenCalled();
  });

  test("re-registers when enabled", () => {
    const registerProvider = vi.fn();
    const unregisterProvider = vi.fn();

    reconcileDedicatedProvider(
      { registerProvider, unregisterProvider },
      () => [],
    );

    expect(registerProvider).toHaveBeenCalledOnce();
    const provider = registerProvider.mock.calls[0][0];
    expect(provider).toMatchObject({
      id: "aperture",
      baseUrl: `${GATEWAY}/v1`,
    });
    expect(unregisterProvider).not.toHaveBeenCalled();
  });
});

describe("refreshModels / cache-only restore", () => {
  test("restores the catalog written by a networked refresh", async () => {
    providersMock.mockResolvedValue([gatewayProvider("openai", ["gpt-x"])]);
    const provider = register();
    const store = memoryStore();

    await refresh(provider, store, true);
    providersMock.mockClear();

    const models = await refresh(provider, store, false);

    expect(models.map((m) => m.id)).toEqual(["gpt-x"]);
    expect(models[0]?.provider).toBe("aperture");
    expect(models[0]?.api).toBe("openai-completions");
    expect(providersMock).not.toHaveBeenCalled();
  });

  test("repairs cached catalogs from the native-provider release that omitted provider", async () => {
    const provider = register();
    const store = memoryStore({
      models: [
        {
          id: "gpt-x",
          name: "gpt-x",
          api: "openai-completions",
          baseUrl: `${GATEWAY}/v1`,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 8_192,
        },
      ] as unknown as Model<Api>[],
      checkedAt: Date.now(),
      catalogKey: `${GATEWAY} *`,
    });

    const models = await refresh(provider, store, false);

    expect(models[0]?.provider).toBe("aperture");
  });

  test("returns [] when the store is empty", async () => {
    const provider = register();
    const models = await refresh(provider, memoryStore(), false);
    expect(models).toEqual([]);
  });

  test("returns [] when the configured gateway changed", async () => {
    providersMock.mockResolvedValue([gatewayProvider("openai", ["gpt-x"])]);
    const provider = register();
    const store = memoryStore();
    await refresh(provider, store, true);

    getConfig.mockReturnValue({
      ...dedicatedConfig(),
      baseUrl: "http://other-gateway.test",
    });

    const models = await refresh(provider, store, false);
    expect(models).toEqual([]);
  });

  test("rejects a same-prefix but different-origin gateway", async () => {
    providersMock.mockResolvedValue([gatewayProvider("openai", ["gpt-x"])]);
    // Catalog written for an evil lookalike origin that starts with the
    // legitimate gateway URL string.
    getConfig.mockReturnValue({
      ...dedicatedConfig(),
      baseUrl: `${GATEWAY}.evil`,
    });
    const provider = register();
    const store = memoryStore();
    await refresh(provider, store, true);

    // Back to the legitimate gateway: the stored catalog must not restore.
    getConfig.mockReturnValue(dedicatedConfig());
    const models = await refresh(provider, store, false);
    expect(models).toEqual([]);
  });

  test("returns [] when the dedicated provider filter changed", async () => {
    providersMock.mockResolvedValue([
      gatewayProvider("openai", ["gpt-x"]),
      gatewayProvider("anthropic", ["claude-x"]),
    ]);
    const provider = register();
    const store = memoryStore();
    await refresh(provider, store, true);

    getConfig.mockReturnValue(
      dedicatedConfig(true, [{ id: "anthropic", enabled: true }]),
    );

    const models = await refresh(provider, store, false);
    expect(models).toEqual([]);
  });

  test("returns [] for a legacy entry without a catalog key", async () => {
    const provider = register();
    const store = memoryStore({
      models: [
        { id: "gpt-x", baseUrl: `${GATEWAY}/v1` },
      ] as unknown as Model<Api>[],
      checkedAt: Date.now(),
    });

    const models = await refresh(provider, store, false);
    expect(models).toEqual([]);
  });
});

describe("refreshModels / networked refresh", () => {
  test("fetches, builds, writes the store, and returns models", async () => {
    providersMock.mockResolvedValue([
      gatewayProvider("openai", ["gpt-5", "gpt-4"]),
    ]);
    const provider = register();
    const store = memoryStore();

    const models = await refresh(provider, store, true);

    expect(providersMock).toHaveBeenCalledOnce();
    expect(models.map((m) => m.id)).toEqual(["gpt-5", "gpt-4"]);
    for (const model of models) {
      expect(model.provider).toBe("aperture");
      expect(model.api).toBe("openai-completions");
    }
    expect(store.entry).toBeDefined();
    expect(store.entry?.checkedAt).toBeTypeOf("number");
    expect(store.entry?.models?.map((m) => m.id)).toEqual(["gpt-5", "gpt-4"]);
  });

  test("filters providers by dedicated.providers selection", async () => {
    getConfig.mockReturnValue(
      dedicatedConfig(true, [{ id: "anthropic", enabled: true }]),
    );
    providersMock.mockResolvedValue([
      gatewayProvider("openai", ["gpt-5"]),
      gatewayProvider("anthropic", ["claude-x"]),
    ]);
    const provider = register();

    const models = await refresh(provider, memoryStore(), true);
    expect(models.map((m) => m.id)).toEqual(["claude-x"]);
  });

  test("propagates gateway fetch failures", async () => {
    providersMock.mockRejectedValue(new Error("gateway down"));
    const provider = register();

    await expect(refresh(provider, memoryStore(), true)).rejects.toThrow(
      "gateway down",
    );
  });

  test("failed fetch then cache-only call restores the previous catalog", async () => {
    providersMock.mockResolvedValue([gatewayProvider("openai", ["gpt-5"])]);
    const provider = register();
    const store = memoryStore();

    await refresh(provider, store, true);
    providersMock.mockRejectedValue(new Error("gateway down"));
    await expect(refresh(provider, store, true)).rejects.toThrow();

    // Pi re-calls with allowNetwork: false after a failed refresh.
    const models = await refresh(provider, store, false);
    expect(models.map((m) => m.id)).toEqual(["gpt-5"]);
  });

  test("attaches gateway pricing to model cost", async () => {
    providersMock.mockResolvedValue([
      gatewayProviderWithPricing("synthetic", "syn:large:text", {
        input: "0.00000093",
        input_cache_read: "0.00000018",
        input_cache_write: "0.00000300",
        output: "0.00000300",
      }),
    ]);
    const provider = register();

    const models = await refresh(provider, memoryStore(), true);
    expect(models).toHaveLength(1);
    expect(models[0].cost?.input).toBeCloseTo(0.93, 10);
    expect(models[0].cost?.output).toBe(3);
    expect(models[0].cost?.cacheRead).toBeCloseTo(0.18, 10);
    expect(models[0].cost?.cacheWrite).toBe(3);
  });
});

describe("refreshModels / metadata enrichment", () => {
  test("enriches from the Pi registry (provider-exact match)", async () => {
    providersMock.mockResolvedValue([gatewayProvider("openai", ["gpt-5"])]);
    const provider = register(() => [
      nativeModel("openai", "gpt-5", "https://api.openai.com/v1", {
        name: "GPT-5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400_000,
        maxTokens: 128_000,
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      }),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models[0].name).toBe("GPT-5");
    expect(models[0].reasoning).toBe(true);
    expect(models[0].input).toEqual(["text", "image"]);
    expect(models[0].contextWindow).toBe(400_000);
    expect(models[0].maxTokens).toBe(128_000);
    expect(models[0].cost?.input).toBe(1.25);
  });

  test("partial gateway pricing merges over registry cost", async () => {
    // Gateway reports only a cache-read rate; input/output/cacheWrite must
    // keep the registry values instead of being zeroed or discarded.
    providersMock.mockResolvedValue([
      gatewayProviderWithPricing("openai", "gpt-5", {
        input_cache_read: "0.00000020",
      }),
    ]);
    const provider = register(() => [
      nativeModel("openai", "gpt-5", "https://api.openai.com/v1", {
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 2.5 },
      }),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models[0].cost?.input).toBe(1.25);
    expect(models[0].cost?.output).toBe(10);
    expect(models[0].cost?.cacheRead).toBeCloseTo(0.2, 10);
    expect(models[0].cost?.cacheWrite).toBe(2.5);
  });

  test("gateway pricing wins over registry cost", async () => {
    providersMock.mockResolvedValue([
      gatewayProviderWithPricing("openai", "gpt-5", {
        input: "0.00000200",
        output: "0.00000900",
      }),
    ]);
    const provider = register(() => [
      nativeModel("openai", "gpt-5", "https://api.openai.com/v1", {
        cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      }),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models[0].cost?.input).toBe(2);
    expect(models[0].cost?.output).toBe(9);
  });

  test("falls back to models.dev when the registry has no match", async () => {
    providersMock.mockResolvedValue([gatewayProvider("zai", ["glm-5"])]);
    fetchModelsDevCatalogMock.mockResolvedValue({
      zai: {
        models: {
          "glm-5": {
            name: "GLM-5",
            reasoning: true,
            modalities: { input: ["text", "image"] },
            limit: { context: 200_000, output: 32_768 },
            cost: { input: 0.95, output: 2.55 },
          },
        },
      },
    });
    const provider = register(() => []);

    const models = await refresh(provider, memoryStore(), true);
    expect(models[0].name).toBe("GLM-5");
    expect(models[0].reasoning).toBe(true);
    expect(models[0].input).toEqual(["text", "image"]);
    expect(models[0].contextWindow).toBe(200_000);
    expect(models[0].maxTokens).toBe(32_768);
    expect(models[0].cost?.input).toBe(0.95);
  });

  test("registry wins over models.dev", async () => {
    providersMock.mockResolvedValue([gatewayProvider("zai", ["glm-5"])]);
    fetchModelsDevCatalogMock.mockResolvedValue({
      zai: {
        models: {
          "glm-5": { limit: { context: 200_000, output: 32_768 } },
        },
      },
    });
    const provider = register(() => [
      nativeModel("zai", "glm-5", "https://api.z.ai/api/coding/paas/v4", {
        contextWindow: 128_000,
        maxTokens: 96_000,
      }),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models[0].contextWindow).toBe(128_000);
    expect(models[0].maxTokens).toBe(96_000);
  });

  test("ignores the aperture provider's own registry models for metadata", async () => {
    providersMock.mockResolvedValue([
      gatewayProvider("custom", ["some-model"]),
    ]);
    const provider = register(() => [
      // Stale self-registered model carrying the safe defaults.
      nativeModel("aperture", "some-model", `${GATEWAY}/v1`, {
        contextWindow: 128_000,
        maxTokens: 8_192,
      }),
    ]);
    fetchModelsDevCatalogMock.mockResolvedValue({
      other: {
        models: {
          "some-model": { limit: { context: 1_000_000, output: 65_536 } },
        },
      },
    });

    const models = await refresh(provider, memoryStore(), true);
    // models.dev metadata applies because the self-match was excluded.
    expect(models[0].contextWindow).toBe(1_000_000);
    expect(models[0].maxTokens).toBe(65_536);
  });

  test("keeps safe defaults when nothing matches", async () => {
    providersMock.mockResolvedValue([gatewayProvider("custom", ["mystery"])]);
    const provider = register(() => []);

    const models = await refresh(provider, memoryStore(), true);
    expect(models[0]).toMatchObject({
      name: "mystery",
      reasoning: false,
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 8_192,
    });
  });
});

describe("refreshModels / upstream base URL inference", () => {
  // Z.ai's coding endpoint is /api/coding/paas/v4 (no terminal /v1). A
  // standard /v1/chat/completions client would produce /v4/v1/chat/completions,
  // so the model must register against the gateway root.
  test("routes Z.ai to gateway root via native registry lookup", async () => {
    providersMock.mockResolvedValue([
      gatewayProvider("zai", ["glm-5.2", "glm-4.7"]),
    ]);
    const provider = register(() => [
      nativeModel("zai", "glm-5.2", "https://api.z.ai/api/coding/paas/v4"),
      nativeModel("zai", "glm-4.7", "https://api.z.ai/api/coding/paas/v4"),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models.map((m) => m.baseUrl)).toEqual([GATEWAY, GATEWAY]);
  });

  test("routes OpenAI to gateway /v1 via native registry lookup", async () => {
    providersMock.mockResolvedValue([gatewayProvider("openai", ["gpt-5"])]);
    const provider = register(() => [
      nativeModel("openai", "gpt-5", "https://api.openai.com/v1"),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models.map((m) => m.baseUrl)).toEqual([`${GATEWAY}/v1`]);
  });

  // Root-baseurl providers (Mistral, DeepSeek) must keep gateway /v1: Aperture
  // appends /v1/chat/completions to the root and they serve it. Only non-/v1
  // version segments (Z.ai /v4) need the root.
  test("routes root-baseurl providers (Mistral) to gateway /v1", async () => {
    providersMock.mockResolvedValue([
      gatewayProvider("mistral", ["mistral-small-latest"]),
    ]);
    const provider = register(() => [
      nativeModel("mistral", "mistral-small-latest", "https://api.mistral.ai"),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models.map((m) => m.baseUrl)).toEqual([`${GATEWAY}/v1`]);
  });

  test("falls back to gateway /v1 when no native registry match exists", async () => {
    providersMock.mockResolvedValue([
      gatewayProvider("custom-provider", ["some-model"]),
    ]);
    const provider = register(() => []);

    const models = await refresh(provider, memoryStore(), true);
    expect(models.map((m) => m.baseUrl)).toEqual([`${GATEWAY}/v1`]);
  });

  // Model ids are upstream-standardized, so a model-id match still resolves
  // the upstream base URL when the gateway provider id does not match a
  // native Pi provider.
  test("falls back to model-id match when provider id differs", async () => {
    providersMock.mockResolvedValue([
      gatewayProvider("my-zai-alias", ["glm-5.2"]),
    ]);
    const provider = register(() => [
      nativeModel("zai", "glm-5.2", "https://api.z.ai/api/coding/paas/v4"),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models.map((m) => m.baseUrl)).toEqual([GATEWAY]);
  });

  // After dedicated registration the registry also contains `aperture`
  // provider models with gateway base URLs. Those must not pollute the lookup
  // (they would flip the inference back to /v1 on re-sync).
  test("ignores registry models already rewritten to the gateway", async () => {
    providersMock.mockResolvedValue([gatewayProvider("zai", ["glm-5.2"])]);
    const provider = register(() => [
      nativeModel("zai", "glm-5.2", "https://api.z.ai/api/coding/paas/v4"),
      // Already-rewritten dedicated model from a prior sync.
      nativeModel("aperture", "glm-5.2", GATEWAY),
      nativeModel("aperture", "glm-5.2", `${GATEWAY}/v1`),
    ]);

    const models = await refresh(provider, memoryStore(), true);
    expect(models.map((m) => m.baseUrl)).toEqual([GATEWAY]);
  });
});
