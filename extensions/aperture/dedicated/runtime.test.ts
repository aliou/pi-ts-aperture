import type { Api } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ApertureProvider } from "../../../src/api/types";

// vi.hoisted gives access to the mock fns inside hoisted vi.mock factories
// (which run before top-level bindings are initialized).
const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  client: vi.fn(),
  loadCachedDedicatedModels:
    vi.fn<
      (gatewayUrl: string) => {
        gatewayUrl: string;
        models: ProviderModelConfig[];
        routes: Record<string, Api>;
      } | null
    >(),
  writeCachedDedicatedModels: vi.fn<
    (
      gatewayUrl: string,
      models: ProviderModelConfig[],
      routes: Map<string, Api>,
    ) => Promise<void>
  >(async () => {}),
  providers: vi.fn<(signal?: AbortSignal) => Promise<ApertureProvider[]>>(),
}));

// Mock the config loader so the runtime never touches real config.
vi.mock("../../../src/shared/config/loader", () => ({
  configLoader: {
    getConfig: mocks.getConfig,
  },
}));

// Mock the models cache so we can assert register/write interactions without
// touching disk.
vi.mock("./models-cache", () => ({
  loadCachedDedicatedModels: mocks.loadCachedDedicatedModels,
  writeCachedDedicatedModels: mocks.writeCachedDedicatedModels,
}));

// Mock the ApertureClient so sync never hits the network. The constructor
// implementation is re-applied in beforeEach because vitest's mockReset:true
// wipes implementations between tests.
vi.mock("../../../src/api/client", () => ({
  ApertureClient: mocks.client,
}));

const { configLoader } = await import("../../../src/shared/config/loader");
const { DedicatedRuntime } = await import("./runtime");

const getConfig = vi.mocked(configLoader.getConfig);
const clientMock = vi.mocked(mocks.client);
const loadCachedDedicatedModels = vi.mocked(mocks.loadCachedDedicatedModels);
const writeCachedDedicatedModels = vi.mocked(mocks.writeCachedDedicatedModels);
const providersMock = vi.mocked(mocks.providers);

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

function captureRegistered(
  registerProvider: ReturnType<typeof vi.fn>,
): { models: ProviderModelConfig[]; streamSimple?: unknown } | null {
  if (registerProvider.mock.calls.length === 0) return null;
  const last = registerProvider.mock.calls.at(-1) as
    | [string, { models?: ProviderModelConfig[]; streamSimple?: unknown }]
    | undefined;
  if (!last) return null;
  const [, config] = last;
  return { models: config.models ?? [], streamSimple: config.streamSimple };
}

describe("DedicatedRuntime.registerCached", () => {
  beforeEach(() => {
    getConfig.mockReturnValue(dedicatedConfig());
    // biome-ignore lint/complexity/useArrowFunction: must be constructible (new ApertureClient)
    clientMock.mockImplementation(function () {
      return { providers: providersMock };
    });
    loadCachedDedicatedModels.mockReset();
    writeCachedDedicatedModels.mockReset();
    providersMock.mockReset();
  });

  test("registers from cache synchronously", () => {
    const cachedModels: ProviderModelConfig[] = [
      {
        id: "gpt-x",
        name: "gpt-x",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 8_192,
        api: "aperture",
        baseUrl: `${GATEWAY}/v1`,
      },
    ];
    loadCachedDedicatedModels.mockReturnValue({
      gatewayUrl: GATEWAY,
      models: cachedModels,
      routes: { "gpt-x": "openai-completions" },
    });
    const registerProvider = vi.fn();
    const runtime = new DedicatedRuntime();

    runtime.registerCached({ registerProvider });

    expect(loadCachedDedicatedModels).toHaveBeenCalledWith(GATEWAY);
    expect(registerProvider).toHaveBeenCalledWith(
      "aperture",
      expect.objectContaining({
        baseUrl: `${GATEWAY}/v1`,
        apiKey: "-",
        models: cachedModels,
      }),
    );
    const registered = captureRegistered(registerProvider);
    expect(registered).not.toBeNull();
    expect(registered?.streamSimple).toBeTypeOf("function");
  });

  test("no-ops when dedicated is disabled", () => {
    getConfig.mockReturnValue(dedicatedConfig(false));
    const registerProvider = vi.fn();
    new DedicatedRuntime().registerCached({ registerProvider });

    expect(registerProvider).not.toHaveBeenCalled();
    expect(loadCachedDedicatedModels).not.toHaveBeenCalled();
  });

  test("no-ops when there is no cache (first run)", () => {
    loadCachedDedicatedModels.mockReturnValue(null);
    const registerProvider = vi.fn();
    new DedicatedRuntime().registerCached({ registerProvider });

    expect(registerProvider).not.toHaveBeenCalled();
  });

  test("no-ops when cache is for a different gateway URL", () => {
    loadCachedDedicatedModels.mockReturnValue(null);
    const registerProvider = vi.fn();
    new DedicatedRuntime().registerCached({ registerProvider });

    expect(registerProvider).not.toHaveBeenCalled();
  });

  test("no-ops when baseUrl is unset", () => {
    getConfig.mockReturnValue({
      ...dedicatedConfig(),
      baseUrl: "",
    });
    const registerProvider = vi.fn();
    new DedicatedRuntime().registerCached({ registerProvider });

    expect(registerProvider).not.toHaveBeenCalled();
  });
});

describe("DedicatedRuntime.syncConfig", () => {
  beforeEach(() => {
    getConfig.mockReturnValue(dedicatedConfig());
    // biome-ignore lint/complexity/useArrowFunction: must be constructible (new ApertureClient)
    clientMock.mockImplementation(function () {
      return { providers: providersMock };
    });
    loadCachedDedicatedModels.mockReset();
    writeCachedDedicatedModels.mockReset();
    providersMock.mockReset();
  });

  test("fetches, registers, and writes the cache", async () => {
    providersMock.mockResolvedValue([
      gatewayProvider("openai", ["gpt-5", "gpt-4"]),
    ]);
    const registerProvider = vi.fn();
    const runtime = new DedicatedRuntime();

    await runtime.sync({ registerProvider });

    expect(providersMock).toHaveBeenCalledOnce();
    expect(registerProvider).toHaveBeenCalledWith(
      "aperture",
      expect.objectContaining({
        baseUrl: `${GATEWAY}/v1`,
        models: expect.arrayContaining([
          expect.objectContaining({ id: "gpt-5", api: "aperture" }),
          expect.objectContaining({ id: "gpt-4", api: "aperture" }),
        ]),
      }),
    );
    expect(writeCachedDedicatedModels).toHaveBeenCalledOnce();
    const [url, models, routes] = writeCachedDedicatedModels.mock.calls[0];
    expect(url).toBe(GATEWAY);
    expect(models.map((m: { id: string }) => m.id)).toEqual(["gpt-5", "gpt-4"]);
    expect(routes.get("gpt-5")).toBe("openai-completions");
  });

  test("does not write cache when no models were resolved", async () => {
    providersMock.mockResolvedValue([gatewayProvider("openai", [])]);
    const registerProvider = vi.fn();
    await new DedicatedRuntime().sync({ registerProvider });

    expect(registerProvider).not.toHaveBeenCalled();
    expect(writeCachedDedicatedModels).not.toHaveBeenCalled();
  });

  test("filters providers by dedicated.providers selection", async () => {
    getConfig.mockReturnValue(
      dedicatedConfig(true, [{ id: "anthropic", enabled: true }]),
    );
    providersMock.mockResolvedValue([
      gatewayProvider("openai", ["gpt-5"]),
      gatewayProvider("anthropic", ["claude-x"]),
    ]);
    const registerProvider = vi.fn();
    await new DedicatedRuntime().sync({ registerProvider });

    const { models } = captureRegistered(registerProvider) ?? {
      models: [],
    };
    expect(models.map((m) => m.id)).toEqual(["claude-x"]);
  });

  test("respects disabled capability", async () => {
    getConfig.mockReturnValue(dedicatedConfig(false));
    const registerProvider = vi.fn();
    await new DedicatedRuntime().sync({ registerProvider });

    expect(providersMock).not.toHaveBeenCalled();
    expect(registerProvider).not.toHaveBeenCalled();
  });
});
