import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, type Mock, test, vi } from "vitest";
import { ApertureClient } from "../../../src/api/client";
import { shouldUseGatewayRoot } from "../../../src/base-url-routing";
import { configLoader } from "../../shared/config/loader";
import type { ResolvedConfig } from "../../shared/config/types";
import type { Api, Model } from "../../shared/types";
import { ApertureRuntime } from "./runtime";

vi.mock("../../shared/config/loader", () => ({
  configLoader: {
    getConfig: vi.fn(),
  },
}));

vi.mock("../../../src/api/client", () => ({
  ApertureClient: vi.fn(),
}));

const getConfig = vi.mocked(configLoader.getConfig);

function model(
  provider: string,
  id: string,
  api?: Api,
  baseUrl?: string,
): Model<Api> {
  return { provider, id, api, baseUrl } as Model<Api>;
}

// Builds SyncDeps whose getProvider returns a fake native provider backed by
// the supplied models, and records native re-registrations so tests can assert
// on the wrapped provider's rewritten getModels() baseUrl.
function syncDeps(models: () => Model<Api>[]) {
  const registerNativeProvider = vi.fn();
  const registerProviderConfig = vi.fn();
  const store = new Map<string, { getModels: () => Model<Api>[] }>();
  const deps = {
    native: {
      getProvider: (id: string) => {
        if (!store.has(id)) {
          store.set(id, {
            getModels: () => models().filter((m) => m.provider === id),
          });
        }
        return store.get(id);
      },
      registerNativeProvider: (p: {
        id: string;
        getModels: () => Model<Api>[];
      }) => {
        registerNativeProvider(p);
        store.set(p.id, p);
      },
    },
    registerProviderConfig,
    unregisterProvider: vi.fn(),
    getModels: models,
  };
  return { deps, registerNativeProvider, registerProviderConfig };
}

function wrappedBaseUrl(
  mock: ReturnType<typeof vi.fn>,
  providerId: string,
): string | undefined {
  const call = mock.mock.calls.find(
    ([p]: unknown[]) => (p as { id?: string }).id === providerId,
  );
  return (call?.[0] as { getModels?: () => Model<Api>[] })?.getModels?.()?.[0]
    ?.baseUrl;
}

function provider(id: string, models: string[]) {
  return { id, name: id, models, compatibility: {} };
}

function proxyConfig(
  upstreamProviders: {
    id: string;
    shouldCheckGatewayModels: boolean;
    keepGatewayModelsOnly?: boolean;
    api?: string;
  }[],
) {
  return {
    baseUrl: "http://gateway.test",
    onboardingDone: true,
    onboarding: { enabled: false },
    proxy: { enabled: true, upstreamProviders },
    dedicated: { enabled: false, providers: [] },
    connectors: { enabled: false, pinnedTools: [], discoveryTools: true },
  };
}

async function check(models: Model<Api>[]) {
  const notify = vi.fn();
  const runtime = new ApertureRuntime();

  await runtime.checkMissingModels(
    {
      getModels: () => models,
      notify,
    },
    [provider("synthetic", ["foo", "bar", "syn-1"])],
  );

  return notify;
}

describe("ApertureRuntime.sync", () => {
  beforeEach(() => {
    getConfig.mockReturnValue(
      proxyConfig([
        { id: "anthropic", shouldCheckGatewayModels: false },
        { id: "openai", shouldCheckGatewayModels: false },
        { id: "openai-codex", shouldCheckGatewayModels: false },
      ]),
    );
  });

  test("tracks Pi Codex path behavior that requires gateway root", async () => {
    const codexProviderUrl = await import.meta.resolve(
      "@earendil-works/pi-ai/api/openai-codex-responses",
    );
    const source = readFileSync(new URL(codexProviderUrl), "utf8");

    expect(source).toMatch(
      /function resolveCodexUrl[\s\S]*if \(normalized\.endsWith\("\/codex\/responses"\)\)[\s\S]*return normalized;[\s\S]*if \(normalized\.endsWith\("\/codex"\)\)[\s\S]*return `\$\{normalized\}\/responses`;[\s\S]*return `\$\{normalized\}\/codex\/responses`;/,
    );
    expect(shouldUseGatewayRoot("openai-codex-responses")).toBe(true);
    expect(shouldUseGatewayRoot("anthropic-messages")).toBe(true);
    expect(shouldUseGatewayRoot("openai-responses")).toBe(false);
  });

  test("uses gateway root for Anthropic and Codex because Pi appends API paths", async () => {
    const { deps, registerNativeProvider } = syncDeps(() => [
      model("anthropic", "claude-sonnet-4-6", "anthropic-messages"),
      model(
        "openai",
        "gpt-5.5",
        "openai-responses",
        "https://api.openai.com/v1",
      ),
      model("openai-codex", "gpt-5.5", "openai-codex-responses"),
    ]);
    const runtime = new ApertureRuntime();

    await runtime.sync(deps);

    expect(wrappedBaseUrl(registerNativeProvider, "anthropic")).toBe(
      "http://gateway.test",
    );
    expect(wrappedBaseUrl(registerNativeProvider, "openai")).toBe(
      "http://gateway.test/v1",
    );
    expect(wrappedBaseUrl(registerNativeProvider, "openai-codex")).toBe(
      "http://gateway.test",
    );
  });
});

describe("shouldUseGatewayRoot OpenAI SDK path inference", () => {
  test.each([
    // /v1 baseurls keep gateway /v1 (OpenAI, Groq, OpenRouter, etc.).
    ["openai", "https://api.openai.com/v1", true, false],
    ["groq", "https://api.groq.com/openai/v1", true, false],
    ["openrouter", "https://openrouter.ai/api/v1", true, false],
    ["trailing-slash", "https://example.test/v1/", true, false],
    // Root baseurls (Mistral, DeepSeek, Fireworks) keep gateway /v1: Aperture
    // appends /v1/chat/completions to the root and the upstream serves it.
    ["mistral", "https://api.mistral.ai", true, false],
    ["deepseek", "https://api.deepseek.com", true, false],
    ["fireworks", "https://api.fireworks.ai/inference", true, false],
    // Non-/v1 version segments need the gateway root: Aperture would otherwise
    // double the version (/v4/v1/chat/completions).
    ["zai", "https://api.z.ai/api/coding/paas/v4", true, true],
    ["zai-v4beta", "https://api.z.ai/api/coding/paas/v4beta", true, true],
    ["v2", "https://example.test/v2", true, true],
    ["v10", "https://example.test/v10", true, true],
    // Non-version path segments are not treated as versions.
    ["non-version", "https://example.test/inference", true, false],
    ["vision", "https://example.test/vision", true, false],
    // openai-responses follows the same rule.
    ["responses-openai", "https://api.openai.com/v1", false, false],
    ["responses-zai", "https://api.z.ai/api/coding/paas/v4", false, true],
  ])("%s completions baseUrl %s", (_name, baseUrl, isCompletions, expectedRoot) => {
    const api: Api = isCompletions ? "openai-completions" : "openai-responses";
    expect(shouldUseGatewayRoot(api, baseUrl)).toBe(expectedRoot);
  });

  test("missing upstream base URL keeps /v1 for OpenAI SDK APIs", () => {
    expect(shouldUseGatewayRoot("openai-completions")).toBe(false);
    expect(shouldUseGatewayRoot("openai-responses")).toBe(false);
  });

  test("unparseable base URL keeps /v1 for OpenAI SDK APIs", () => {
    expect(shouldUseGatewayRoot("openai-completions", "not a url")).toBe(false);
  });

  test("non-OpenAI-SDK APIs keep /v1 regardless of base URL", () => {
    expect(
      shouldUseGatewayRoot("google-generative-ai", "https://example.test/v4"),
    ).toBe(false);
  });

  test("Anthropic and Codex always use root regardless of base URL", () => {
    expect(
      shouldUseGatewayRoot("anthropic-messages", "https://example.test/v1"),
    ).toBe(true);
    expect(
      shouldUseGatewayRoot("openai-codex-responses", "https://example.test/v1"),
    ).toBe(true);
  });
});

describe("ApertureRuntime.sync OpenAI SDK inference", () => {
  beforeEach(() => {
    getConfig.mockReturnValue(
      proxyConfig([
        { id: "zai", shouldCheckGatewayModels: false },
        { id: "openai", shouldCheckGatewayModels: false },
        { id: "groq", shouldCheckGatewayModels: false },
      ]),
    );
  });

  test("routes Z.ai to gateway root and OpenAI/Groq to gateway /v1", async () => {
    const { deps, registerNativeProvider } = syncDeps(() => [
      model(
        "zai",
        "glm-4.5-air",
        "openai-completions",
        "https://api.z.ai/api/coding/paas/v4",
      ),
      model(
        "openai",
        "gpt-5.5",
        "openai-responses",
        "https://api.openai.com/v1",
      ),
      model(
        "groq",
        "llama-4",
        "openai-completions",
        "https://api.groq.com/openai/v1",
      ),
    ]);
    const runtime = new ApertureRuntime();

    await runtime.sync(deps);

    expect(wrappedBaseUrl(registerNativeProvider, "zai")).toBe(
      "http://gateway.test",
    );
    expect(wrappedBaseUrl(registerNativeProvider, "openai")).toBe(
      "http://gateway.test/v1",
    );
    expect(wrappedBaseUrl(registerNativeProvider, "groq")).toBe(
      "http://gateway.test/v1",
    );
  });

  test("keeps the inferred upstream base URL stable across re-syncs", async () => {
    const { deps, registerNativeProvider } = syncDeps(() => [
      model(
        "zai",
        "glm-4.5-air",
        "openai-completions",
        "https://api.z.ai/api/coding/paas/v4",
      ),
    ]);
    const runtime = new ApertureRuntime();

    await runtime.sync(deps);

    // Second sync: model list is already rewritten to the gateway (as Pi
    // would surface after a settings reload). The cached upstream URL must
    // keep Z.ai on gateway root instead of flipping back to /v1.
    await runtime.sync({
      ...deps,
      getModels: () => [
        model(
          "zai",
          "glm-4.5-air",
          "openai-completions",
          "http://gateway.test",
        ),
      ],
    });

    const zaiCalls = registerNativeProvider.mock.calls.filter(
      ([p]: unknown[]) => (p as { id?: string }).id === "zai",
    );
    expect(zaiCalls).toHaveLength(2);
    for (const [p] of zaiCalls) {
      expect(
        (p as { getModels: () => Model<Api>[] }).getModels()[0].baseUrl,
      ).toBe("http://gateway.test");
    }
  });
});

describe("ApertureRuntime.sync fixed-path APIs", () => {
  test("routes a proxied Bedrock provider through /bedrock, not /v1", async () => {
    // Regression for the shared-resolver move: proxy used to inline only
    // shouldUseGatewayRoot, which is false for bedrock-converse-stream, so a
    // proxied bedrock provider was registered at gateway/v1 (protocol error).
    // It now goes through the shared getBaseUrlForApi -> /bedrock.
    getConfig.mockReturnValue(
      proxyConfig([{ id: "bedrock", shouldCheckGatewayModels: false }]),
    );
    const { deps, registerNativeProvider } = syncDeps(() => [
      model(
        "bedrock",
        "anthropic.claude-3-5-sonnet-20241022-v2:0",
        "bedrock-converse-stream",
        "https://bedrock-runtime.us-east-1.amazonaws.com",
      ),
    ]);
    const runtime = new ApertureRuntime();

    await runtime.sync(deps);

    expect(wrappedBaseUrl(registerNativeProvider, "bedrock")).toBe(
      "http://gateway.test/bedrock",
    );
  });

  test("aligns a proxied Gemini provider to /v1beta via the shared resolver", async () => {
    // Side effect of sharing getBaseUrlForApi: proxy Gemini now matches
    // dedicated and routes to /v1beta instead of the OpenAI-shaped /v1.
    getConfig.mockReturnValue(
      proxyConfig([{ id: "google", shouldCheckGatewayModels: false }]),
    );
    const { deps, registerNativeProvider } = syncDeps(() => [
      model("google", "gemini-2.5-pro", "google-generative-ai"),
    ]);
    const runtime = new ApertureRuntime();

    await runtime.sync(deps);

    expect(wrappedBaseUrl(registerNativeProvider, "google")).toBe(
      "http://gateway.test/v1beta",
    );
  });
});

describe("ApertureRuntime.sync provider-qualified model ids", () => {
  beforeEach(() => {
    getConfig.mockReturnValue(
      proxyConfig([{ id: "synthetic", shouldCheckGatewayModels: false }]),
    );
  });

  test("getModels() keeps bare ids while stream dispatch rewrites them", async () => {
    const stream = vi.fn().mockReturnValue("stream-result");
    const streamSimple = vi.fn().mockReturnValue("stream-simple-result");
    const native = {
      id: "synthetic",
      getModels: () => [model("synthetic", "foo")],
      stream,
      streamSimple,
    };
    const registerNativeProvider = vi.fn();
    const registerProviderConfig = vi.fn();
    const deps = {
      native: {
        getProvider: vi.fn().mockReturnValue(native),
        registerNativeProvider,
      },
      registerProviderConfig,
      getModels: () => [model("synthetic", "foo")],
    };

    await new ApertureRuntime().sync(deps);

    const wrapped = (
      registerNativeProvider.mock.calls[0] as [typeof native]
    )[0];
    const bareModel = model("synthetic", "foo");
    // Branch exclusivity: a config registration on a native host deletes the
    // extension-native provider entry, so requests would keep their baked
    // upstream URL and bypass the gateway entirely.
    expect(registerProviderConfig).not.toHaveBeenCalled();
    expect(wrapped.getModels().map((m) => m.id)).toEqual(["foo"]);

    const context = {} as never;
    expect(wrapped.stream(bareModel, context, undefined)).toBe("stream-result");
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      provider: "synthetic",
      id: "synthetic/foo",
    });

    stream.mockClear();
    expect(wrapped.streamSimple(bareModel, context, undefined)).toBe(
      "stream-simple-result",
    );
    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      provider: "synthetic",
      id: "synthetic/foo",
    });

    // The original model object must not be mutated by the rewrite.
    expect(bareModel.id).toBe("foo");
  });

  // Regression: from the second sync onwards, deps.getProvider returns our own
  // previous wrapper. Routing stream/streamSimple through `native` (the
  // wrapper) double-qualifies; delegate through the first-seen provider.
  test("stream dispatch does not double-qualify across re-syncs", async () => {
    const stream = vi.fn().mockReturnValue("stream-result");
    const streamSimple = vi.fn().mockReturnValue("stream-simple-result");
    // An external store mimicking Pi's provider registry: registration
    // replaces the entry, so a later getProvider returns the wrapper.
    const store = new Map<string, unknown>();
    store.set("synthetic", {
      id: "synthetic",
      getModels: () => [model("synthetic", "foo")],
      stream,
      streamSimple,
    });
    const deps = {
      native: {
        getProvider: (id: string) => store.get(id),
        registerNativeProvider: (p: { id: string }) => void store.set(p.id, p),
      },
      registerProviderConfig: vi.fn(),
      unregisterProvider: vi.fn(),
      getModels: () => [model("synthetic", "foo")],
    };

    const runtime = new ApertureRuntime();
    await runtime.sync(deps as never);
    await runtime.sync(deps as never);

    const wrapped = store.get("synthetic") as {
      stream: (m: Model<Api>, c: never, o: never) => unknown;
      streamSimple: (m: Model<Api>, c: never, o: never) => unknown;
    };
    const context = {} as never;

    wrapped.stream(model("synthetic", "foo"), context, undefined);
    expect(stream.mock.calls[0]?.[0]).toMatchObject({ id: "synthetic/foo" });

    streamSimple.mockClear();
    wrapped.streamSimple(model("synthetic", "foo"), context, undefined);
    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "synthetic/foo",
    });
  });
});

describe("ApertureRuntime.checkMissingModels", () => {
  beforeEach(() => {
    getConfig.mockReturnValue(
      proxyConfig([{ id: "synthetic", shouldCheckGatewayModels: true }]),
    );
  });

  test("matches gateway models by provider model arrays", async () => {
    const notify = await check([
      model("synthetic", "foo"),
      model("openrouter", "foo"),
    ]);

    expect(notify).not.toHaveBeenCalled();
  });

  test("only checks configured providers", async () => {
    const notify = await check([
      model("synthetic", "foo"),
      model("openrouter", "missing-openrouter"),
    ]);

    expect(notify).not.toHaveBeenCalled();
  });

  test("truncates missing models per provider", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        { id: "openrouter", shouldCheckGatewayModels: true },
        { id: "synthetic", shouldCheckGatewayModels: true },
      ]),
    );
    const notify = vi.fn();
    const runtime = new ApertureRuntime();

    await runtime.checkMissingModels(
      {
        getModels: () => [
          model("openrouter", "or-1"),
          model("openrouter", "or-2"),
          model("openrouter", "or-3"),
          model("openrouter", "or-4"),
          model("openrouter", "or-5"),
          model("openrouter", "or-6"),
          model("openrouter", "or-7"),
          model("synthetic", "syn-1"),
          model("synthetic", "syn-2"),
          model("synthetic", "syn-3"),
        ],
        notify,
      },
      [provider("synthetic", ["syn-1"]), provider("openrouter", [])],
    );

    expect(notify).toHaveBeenCalledOnce();
    const message = notify.mock.calls[0][0];
    expect(message).toContain(
      "openrouter: or-1, or-2, or-3, or-4, or-5, 2 more",
    );
    expect(message).toContain("synthetic: syn-2, syn-3");
  });

  test("skips when proxy is disabled", async () => {
    getConfig.mockReturnValue({
      baseUrl: "http://gateway.test",
      onboardingDone: true,
      onboarding: { enabled: false },
      proxy: { enabled: false, upstreamProviders: [] },
      dedicated: { enabled: true, providers: [] },
    });

    const notify = await check([model("synthetic", "foo")]);
    expect(notify).not.toHaveBeenCalled();
  });

  test("only checks providers with shouldCheckGatewayModels=true", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        { id: "synthetic", shouldCheckGatewayModels: true },
        { id: "openrouter", shouldCheckGatewayModels: false },
      ]),
    );

    const notify = await check([
      model("synthetic", "foo"),
      model("openrouter", "missing-openrouter"),
    ]);

    expect(notify).not.toHaveBeenCalled();
  });
});

// Regression: when the gateway is transiently unavailable, providers() rejects
// (e.g. a 5s abort timeout). checkMissingModels is fire-and-forget in the sync
// handler, so an unhandled rejection would crash Pi via uncaughtException. This
// is a warning-only check and must silently swallow gateway failures.
describe("ApertureRuntime.checkMissingModels gateway failures", () => {
  test("swallows gateway provider fetch errors", async () => {
    getConfig.mockReturnValue(
      proxyConfig([{ id: "synthetic", shouldCheckGatewayModels: true }]),
    );
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi.fn().mockRejectedValue(err);
      return this;
    } as unknown as typeof ApertureClient);

    const notify = vi.fn();
    const runtime = new ApertureRuntime();

    await expect(
      runtime.checkMissingModels({
        getModels: () => [model("synthetic", "missing-model")],
        notify,
      }),
    ).resolves.toBeUndefined();

    expect(notify).not.toHaveBeenCalled();
  });
});

describe("ApertureRuntime.resolveProxyProviderSync", () => {
  const runtime = new ApertureRuntime();

  function config(
    enabled: boolean,
    upstreamProviders: (string | { id: string; enabled: boolean })[],
  ): ResolvedConfig {
    return {
      baseUrl: "http://gateway.test",
      onboardingDone: true,
      onboarding: { enabled: false },
      proxy: {
        enabled,
        upstreamProviders: upstreamProviders.map((p) => ({
          shouldCheckGatewayModels: false,
          ...(typeof p === "string" ? { id: p } : p),
        })),
      },
      dedicated: { enabled: false, providers: [] },
      connectors: { enabled: false, pinnedTools: [], discoveryTools: true },
    };
  }

  test("unregisters providers removed from the proxy list when enabled", () => {
    const result = runtime.resolveProxyProviderSync(
      config(true, ["openai", "openrouter"]),
      ["openai", "anthropic"],
    );

    expect(result.next).toEqual(["openai", "openrouter"]);
    expect(result.unregister).toEqual(["anthropic"]);
  });

  test("unregisters nothing when the provider list is unchanged", () => {
    const result = runtime.resolveProxyProviderSync(
      config(true, ["openai", "openrouter"]),
      ["openai", "openrouter"],
    );

    expect(result.next).toEqual(["openai", "openrouter"]);
    expect(result.unregister).toEqual([]);
  });

  test("unregisters providers configured with enabled: false", () => {
    const result = runtime.resolveProxyProviderSync(
      config(true, ["openai", { id: "anthropic", enabled: false }]),
      ["openai", "anthropic"],
    );

    expect(result.next).toEqual(["openai"]);
    expect(result.unregister).toEqual(["anthropic"]);
  });

  test("does not unregister providers when proxy is disabled, even if they remain configured", () => {
    // Regression: previously, disabling proxy while providers were still
    // listed caused every previously-proxied provider to be unregistered and
    // surfaced a spurious "unregistered" notification. Providers must stay
    // registered when proxy is toggled off.
    const result = runtime.resolveProxyProviderSync(
      config(false, ["openai", "openrouter"]),
      ["openai", "openrouter"],
    );

    expect(result.unregister).toEqual([]);
    // `next` keeps the previous list so a future re-enable can diff correctly.
    expect(result.next).toEqual(["openai", "openrouter"]);
  });
});

describe("ApertureRuntime.sync gateway model filtering", () => {
  function mockGateway(providersById: Record<string, string[]> | Error) {
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers =
        providersById instanceof Error
          ? vi.fn().mockRejectedValue(providersById)
          : vi
              .fn()
              .mockResolvedValue(
                Object.entries(providersById).map(([id, models]) =>
                  provider(id, models),
                ),
              );
      return this;
    } as unknown as typeof ApertureClient);
  }

  function lastRegisteredModels(
    mock: ReturnType<typeof vi.fn>,
    providerId: string,
  ): Model<Api>[] {
    const call = mock.mock.calls
      .filter(([p]: unknown[]) => (p as { id?: string }).id === providerId)
      .at(-1);
    return (
      (call?.[0] as { getModels?: () => Model<Api>[] })?.getModels?.() ?? []
    );
  }

  const openAiModels = () => [
    model("openai", "gpt-5.5", "openai-responses", "https://api.openai.com/v1"),
    model("openai", "gpt-4o", "openai-responses", "https://api.openai.com/v1"),
  ];

  test("registers only the models the gateway lists when the flag is on", async () => {
    mockGateway({ openai: ["gpt-5.5"] });
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    const { deps, registerNativeProvider } = syncDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(
      lastRegisteredModels(registerNativeProvider, "openai").map((m) => m.id),
    ).toEqual(["gpt-5.5"]);
  });

  test("only opted-in providers are filtered", async () => {
    mockGateway({ openai: ["gpt-5.5"], groq: [] });
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
        { id: "groq", shouldCheckGatewayModels: false },
      ]),
    );
    const { deps, registerNativeProvider } = syncDeps(() => [
      model(
        "groq",
        "llama-4",
        "openai-completions",
        "https://api.groq.com/openai/v1",
      ),
      model(
        "openai",
        "gpt-5.5",
        "openai-responses",
        "https://api.openai.com/v1",
      ),
      model(
        "openai",
        "gpt-4o",
        "openai-responses",
        "https://api.openai.com/v1",
      ),
    ]);

    await new ApertureRuntime().sync(deps);

    expect(
      lastRegisteredModels(registerNativeProvider, "openai").map((m) => m.id),
    ).toEqual(["gpt-5.5"]);
    expect(
      lastRegisteredModels(registerNativeProvider, "groq").map((m) => m.id),
    ).toEqual(["llama-4"]);
  });

  test("restores the full list when the flag turns off across syncs", async () => {
    mockGateway({ openai: ["gpt-5.5"] });
    const { deps, registerNativeProvider } = syncDeps(openAiModels);
    const runtime = new ApertureRuntime();

    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    await runtime.sync(deps);
    expect(
      lastRegisteredModels(registerNativeProvider, "openai").map((m) => m.id),
    ).toEqual(["gpt-5.5"]);

    getConfig.mockReturnValue(
      proxyConfig([{ id: "openai", shouldCheckGatewayModels: false }]),
    );
    await runtime.sync(deps);
    expect(
      lastRegisteredModels(registerNativeProvider, "openai").map((m) => m.id),
    ).toEqual(["gpt-5.5", "gpt-4o"]);
  });

  test("skips a provider when the gateway lists none of its models", async () => {
    mockGateway({ openai: [] });
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    const { deps, registerNativeProvider } = syncDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(registerNativeProvider).not.toHaveBeenCalled();
  });

  test("registers everything unfiltered when the catalog fetch fails", async () => {
    mockGateway(new Error("gateway unreachable"));
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    const { deps, registerNativeProvider } = syncDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(
      lastRegisteredModels(registerNativeProvider, "openai").map((m) => m.id),
    ).toEqual(["gpt-5.5", "gpt-4o"]);
  });

  // Regression: the guard is "skip only when filtering left nothing", not
  // "skip whenever the list is empty". A dynamic native provider whose
  // getModels() is momentarily empty must still be re-registered, or it
  // loses its gateway routing for the rest of the session. An unfiltered
  // provider therefore reaches registration even with no models.
  test("re-registers an unfiltered native provider whose model list is empty", async () => {
    mockGateway({ openai: ["gpt-5.5"] });
    getConfig.mockReturnValue(
      proxyConfig([{ id: "openai", shouldCheckGatewayModels: false }]),
    );
    // The registry still reports a model for the provider (so the loop does
    // not skip earlier), but the provider object itself lists none.
    const registerNativeProvider = vi.fn();
    const deps = {
      native: {
        getProvider: () => ({ id: "openai", getModels: () => [] }),
        registerNativeProvider,
      },
      registerProviderConfig: vi.fn(),
      unregisterProvider: vi.fn(),
      getModels: openAiModels,
    };

    await new ApertureRuntime().sync(deps as never);

    expect(registerNativeProvider).toHaveBeenCalledTimes(1);
  });

  // The other arm: with filtering on and nothing served, it must skip.
  test("skips a filtered native provider when the gateway serves none of it", async () => {
    mockGateway({ openai: ["something-else"] });
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    const { deps, registerNativeProvider } = syncDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(registerNativeProvider).not.toHaveBeenCalled();
  });
});

describe("ApertureRuntime.sync api overrides", () => {
  function mockGatewayCompatibility(
    list: { id: string; compatibility: Record<string, boolean> }[],
  ) {
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi.fn().mockResolvedValue(
        list.map((gp) => ({
          id: gp.id,
          name: gp.id,
          models: ["m-1"],
          compatibility: gp.compatibility,
        })),
      );
      return this;
    } as unknown as typeof ApertureClient);
  }

  function lastRegistered(
    mock: ReturnType<typeof vi.fn>,
    providerId: string,
  ): Model<Api>[] {
    const call = mock.mock.calls
      .filter(([p]: unknown[]) => (p as { id?: string }).id === providerId)
      .at(-1);
    return (
      (call?.[0] as { getModels?: () => Model<Api>[] })?.getModels?.() ?? []
    );
  }

  const neuralwattModels = () => [
    model(
      "neuralwatt",
      "kimi-k3",
      "openai-completions",
      "https://api.neuralwatt.com/v1",
    ),
  ];

  beforeEach(() => {
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "neuralwatt",
          shouldCheckGatewayModels: false,
          api: "anthropic-messages",
        },
      ]),
    );
    mockGatewayCompatibility([
      {
        id: "neuralwatt",
        compatibility: { openai_chat: true, anthropic_messages: true },
      },
    ]);
  });

  test("the override wins over the provider's own api and drives the base url", async () => {
    const { deps, registerNativeProvider } = syncDeps(neuralwattModels);

    await new ApertureRuntime().sync(deps);

    const models = lastRegistered(registerNativeProvider, "neuralwatt");
    expect(models[0]?.api).toBe("anthropic-messages");
    expect(models[0]?.baseUrl).toBe("http://gateway.test");
  });

  test("an unserved override warns and falls back to the provider's api", async () => {
    mockGatewayCompatibility([
      { id: "neuralwatt", compatibility: { openai_chat: true } },
    ]);
    const notify = vi.fn();
    const { deps, registerNativeProvider } = syncDeps(neuralwattModels);

    await new ApertureRuntime().sync({ ...deps, notify });

    const models = lastRegistered(registerNativeProvider, "neuralwatt");
    expect(models[0]?.api).toBe("openai-completions");
    expect(models[0]?.baseUrl).toBe("http://gateway.test/v1");
    expect(notify).toHaveBeenCalledOnce();
    const message = notify.mock.calls[0][0];
    expect(message).toContain("anthropic-messages");
    expect(message).toContain("neuralwatt");
    expect(message).toContain("provider's own api (openai-completions)");
  });

  test("removing the override restores the original api across re-syncs", async () => {
    const { deps, registerNativeProvider } = syncDeps(neuralwattModels);
    const runtime = new ApertureRuntime();

    await runtime.sync(deps);
    expect(lastRegistered(registerNativeProvider, "neuralwatt")[0]?.api).toBe(
      "anthropic-messages",
    );

    getConfig.mockReturnValue(
      proxyConfig([{ id: "neuralwatt", shouldCheckGatewayModels: false }]),
    );
    await runtime.sync({
      ...deps,
      getModels: () => [
        model(
          "neuralwatt",
          "kimi-k3",
          "anthropic-messages",
          "http://gateway.test",
        ),
      ],
    });

    const models = lastRegistered(registerNativeProvider, "neuralwatt");
    expect(models[0]?.api).toBe("openai-completions");
    expect(models[0]?.baseUrl).toBe("http://gateway.test/v1");
  });

  test("overrides stay inert when the gateway catalog is unreachable", async () => {
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi.fn().mockRejectedValue(new Error("gateway down"));
      return this;
    } as unknown as typeof ApertureClient);
    const notify = vi.fn();
    const { deps, registerNativeProvider } = syncDeps(neuralwattModels);

    await new ApertureRuntime().sync({ ...deps, notify });

    const models = lastRegistered(registerNativeProvider, "neuralwatt");
    expect(models[0]?.api).toBe("openai-completions");
    expect(models[0]?.baseUrl).toBe("http://gateway.test/v1");
    // The override falls back without its own "not served by the gateway"
    // warning — the catalog never said that. What the user does get told is
    // that the catalog was unreachable, which is the actual cause.
    expect(notify).not.toHaveBeenCalledWith(
      expect.stringContaining("is not served by the gateway"),
      "warning",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("could not reach the gateway catalog"),
      "warning",
    );
  });

  test("a provider with enabled: false is not proxied", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "neuralwatt",
          enabled: false,
          shouldCheckGatewayModels: false,
          api: "anthropic-messages",
        },
      ]),
    );
    const { deps, registerNativeProvider } = syncDeps(neuralwattModels);

    await new ApertureRuntime().sync(deps);

    expect(
      registerNativeProvider.mock.calls.some(
        ([p]: unknown[]) => (p as { id?: string }).id === "neuralwatt",
      ),
    ).toBe(false);
  });
});

describe("ApertureRuntime.sync passthrough auth", () => {
  function mockGatewayWithAuthFlags(
    providers: {
      id: string;
      models: string[];
      requires_client_auth?: boolean;
    }[],
  ) {
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi.fn().mockResolvedValue(providers);
      return this;
    } as unknown as typeof ApertureClient);
  }

  // A native provider carrying an apiKey auth with a real `resolve`, like
  // Pi's built-in env-key providers (openrouter, openai, …).
  function nativeWithApiKey(id: string, models: Model<Api>[]) {
    const resolve = vi.fn().mockResolvedValue({
      auth: { apiKey: "real-key" },
      source: "env",
    });
    return {
      id,
      getModels: () => models,
      auth: { apiKey: { name: `${id} key`, resolve } },
      stream: vi.fn(),
      streamSimple: vi.fn(),
    };
  }

  function syncDepsWithNative(
    natives: Record<string, ReturnType<typeof nativeWithApiKey>>,
  ) {
    const registerNativeProvider = vi.fn();
    const allModels = () =>
      Object.values(natives).flatMap((n) => n.getModels());
    return {
      deps: {
        native: {
          getProvider: (id: string) => natives[id],
          registerNativeProvider,
        },
        registerProviderConfig: vi.fn(),
        unregisterProvider: vi.fn(),
        getModels: allModels,
      },
      registerNativeProvider,
    };
  }

  function wrappedProvider(
    mock: ReturnType<typeof vi.fn>,
    providerId: string,
  ): {
    auth?: {
      apiKey?: {
        check?: (input: unknown) => Promise<unknown>;
        resolve?: (input: unknown) => Promise<unknown>;
      };
    };
  } {
    const call = mock.mock.calls.find(
      ([p]: unknown[]) => (p as { id?: string }).id === providerId,
    );
    return call?.[0] as never;
  }

  beforeEach(() => {
    getConfig.mockReturnValue(
      proxyConfig([
        { id: "openrouter", shouldCheckGatewayModels: false },
        { id: "openai-codex", shouldCheckGatewayModels: false },
      ]),
    );
  });

  test("override/none providers get a placeholder auth that always counts as configured", async () => {
    mockGatewayWithAuthFlags([
      { id: "openrouter", models: ["or-1"], requires_client_auth: false },
    ]);
    const native = nativeWithApiKey("openrouter", [
      model(
        "openrouter",
        "or-1",
        "openai-completions",
        "https://openrouter.ai/api/v1",
      ),
    ]);
    const { deps, registerNativeProvider } = syncDepsWithNative({
      openrouter: native,
    });

    await new ApertureRuntime().sync(deps);

    const wrapped = wrappedProvider(registerNativeProvider, "openrouter");
    expect(wrapped.auth?.apiKey?.check).toBeDefined();
    await expect(wrapped.auth?.apiKey?.check?.({})).resolves.toEqual({
      type: "api_key",
      source: "aperture proxy",
    });
    await expect(wrapped.auth?.apiKey?.resolve?.({})).resolves.toEqual({
      auth: { apiKey: "-" },
      source: "aperture proxy",
    });
    // The native resolve (real key) is not called; the override replaces it.
    expect(native.auth.apiKey.resolve).not.toHaveBeenCalled();
  });

  test("passthrough providers keep their native auth so the client sends a real credential", async () => {
    mockGatewayWithAuthFlags([
      { id: "openai-codex", models: ["gpt-5.5"], requires_client_auth: true },
    ]);
    const native = nativeWithApiKey("openai-codex", [
      model("openai-codex", "gpt-5.5", "openai-codex-responses"),
    ]);
    const { deps, registerNativeProvider } = syncDepsWithNative({
      "openai-codex": native,
    });

    await new ApertureRuntime().sync(deps);

    const wrapped = wrappedProvider(registerNativeProvider, "openai-codex");
    // No placeholder override: the wrapped auth is the native auth untouched.
    expect(wrapped.auth).toBe(native.auth);
    expect(wrapped.auth?.apiKey?.check).toBeUndefined();
    await expect(wrapped.auth?.apiKey?.resolve?.({})).resolves.toEqual({
      auth: { apiKey: "real-key" },
      source: "env",
    });
    expect(native.auth.apiKey.resolve).toHaveBeenCalled();
  });

  test("fetches the catalog once per sync", async () => {
    mockGatewayWithAuthFlags([
      { id: "openrouter", models: ["or-1"], requires_client_auth: false },
    ]);
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openrouter",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    const { deps } = syncDepsWithNative({
      openrouter: nativeWithApiKey("openrouter", [model("openrouter", "or-1")]),
    });

    await new ApertureRuntime().sync(deps);

    // One fetch serves both passthrough detection and model filtering.
    expect(vi.mocked(ApertureClient).mock.calls.length).toBe(1);
  });

  test("recovers native auth when the gateway flips a provider to passthrough mid-session", async () => {
    const native = nativeWithApiKey("openrouter", [
      model("openrouter", "or-1"),
    ]);

    // Simulate real Pi: getProvider returns the last-registered provider, so
    // the second sync sees the first sync's wrapper, not the original native.
    let current: unknown = native;
    const registerNativeProvider = vi.fn((p: unknown) => {
      current = p;
    });
    const deps = {
      native: {
        getProvider: () => current,
        registerNativeProvider,
      },
      registerProviderConfig: vi.fn(),
      unregisterProvider: vi.fn(),
      getModels: () => native.getModels(),
    };

    // First sync: non-passthrough → placeholder auth applied.
    mockGatewayWithAuthFlags([
      { id: "openrouter", models: ["or-1"], requires_client_auth: false },
    ]);
    const runtime = new ApertureRuntime();
    await runtime.sync(deps);

    // Second sync: gateway now marks the provider as passthrough.
    mockGatewayWithAuthFlags([
      { id: "openrouter", models: ["or-1"], requires_client_auth: true },
    ]);
    await runtime.sync(deps);

    // The last wrapper should carry the original native auth, not the stale
    // placeholder from the first sync.
    const lastWrapped = registerNativeProvider.mock.calls.at(-1)?.[0] as
      | {
          auth?: {
            apiKey?: { resolve?: (input: unknown) => Promise<unknown> };
          };
        }
      | undefined;
    await expect(lastWrapped.auth?.apiKey?.resolve?.({})).resolves.toEqual({
      auth: { apiKey: "real-key" },
      source: "env",
    });
    expect(native.auth.apiKey.resolve).toHaveBeenCalled();
  });

  test("fails open when the catalog is unreachable: treats nothing as passthrough", async () => {
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi.fn().mockRejectedValue(new Error("gateway down"));
      return this;
    } as unknown as typeof ApertureClient);
    const native = nativeWithApiKey("openrouter", [
      model("openrouter", "or-1"),
    ]);
    const { deps, registerNativeProvider } = syncDepsWithNative({
      openrouter: native,
    });

    await new ApertureRuntime().sync(deps);

    // Override applied (empty passthrough set), so the provider still counts
    // as configured with the placeholder key.
    const wrapped = wrappedProvider(registerNativeProvider, "openrouter");
    await expect(wrapped.auth?.apiKey?.resolve?.({})).resolves.toEqual({
      auth: { apiKey: "-" },
      source: "aperture proxy",
    });
  });
});

interface RegisteredProviderConfig {
  baseUrl?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: Model<Api>[];
}

// Hosts whose model registry has no `getProvider` cannot be handed a native
// Provider; sync must fall back to name+config registration.
describe("ApertureRuntime.sync config-registration hosts", () => {
  function mockGateway(
    providers:
      | {
          id: string;
          models: string[];
          requires_client_auth?: boolean;
          compatibility?: Record<string, boolean>;
        }[]
      | Error,
  ) {
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers =
        providers instanceof Error
          ? vi.fn().mockRejectedValue(providers)
          : vi.fn().mockResolvedValue(
              providers.map((p) => ({
                id: p.id,
                name: p.id,
                models: p.models,
                compatibility: p.compatibility ?? {},
                ...(p.requires_client_auth
                  ? { requires_client_auth: true }
                  : {}),
              })),
            );
      return this;
    } as unknown as typeof ApertureClient);
  }

  /** SyncDeps without native provider access, as a config-only host exposes. */
  function configDeps(models: () => Model<Api>[]) {
    const registerProviderConfig = vi.fn();
    const unregisterProvider = vi.fn();
    const notify = vi.fn();
    return {
      deps: {
        registerProviderConfig,
        unregisterProvider,
        getModels: models,
        headers: { Referer: "https://pi.dev", "x-session-id": "s-1" },
        notify,
      },
      registerProviderConfig,
      unregisterProvider,
      notify,
    };
  }

  function lastConfig(
    mock: Mock,
    providerId: string,
  ): RegisteredProviderConfig {
    const call = mock.mock.calls.filter(([name]) => name === providerId).at(-1);
    return (call?.[1] ?? {}) as RegisteredProviderConfig;
  }

  const openAiModels = () => [
    model("openai", "gpt-5.5", "openai-responses", "https://api.openai.com/v1"),
    model("openai", "gpt-4o", "openai-responses", "https://api.openai.com/v1"),
  ];

  beforeEach(() => {
    getConfig.mockReturnValue(
      proxyConfig([{ id: "openai", shouldCheckGatewayModels: false }]),
    );
  });

  // Bare ids, not qualified: config registration merges by id, so keeping the
  // upstream id is what overwrites the provider's own definition instead of
  // adding a second gateway-bound copy beside it.
  test("reroutes the provider's own model ids to the gateway base url", async () => {
    mockGateway([{ id: "openai", models: ["gpt-5.5", "gpt-4o"] }]);
    const { deps, registerProviderConfig } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    const config = lastConfig(registerProviderConfig, "openai");
    expect(config.baseUrl).toBe("http://gateway.test/v1");
    expect(config.models?.map((m) => m.id)).toEqual(["gpt-5.5", "gpt-4o"]);
    expect(config.models?.every((m) => m.baseUrl === config.baseUrl)).toBe(
      true,
    );
    expect(config.headers).toEqual({
      Referer: "https://pi.dev",
      "x-session-id": "s-1",
    });
  });

  test("uses the gateway root for an api that appends its own path", async () => {
    getConfig.mockReturnValue(
      proxyConfig([{ id: "anthropic", shouldCheckGatewayModels: false }]),
    );
    mockGateway([{ id: "anthropic", models: ["claude-sonnet-4-6"] }]);
    const { deps, registerProviderConfig } = configDeps(() => [
      model(
        "anthropic",
        "claude-sonnet-4-6",
        "anthropic-messages",
        "https://api.anthropic.com",
      ),
    ]);

    await new ApertureRuntime().sync(deps);

    const config = lastConfig(registerProviderConfig, "anthropic");
    expect(config.baseUrl).toBe("http://gateway.test");
    expect(config.models?.[0]?.api).toBe("anthropic-messages");
  });

  // Regression: emitting a config with `models` and no `apiKey`/`oauth` is
  // rejected by the host ('"apiKey" or "oauth" is required when defining
  // models'), which threw out of sync() and took the session with it. A
  // passthrough credential cannot be expressed in a provider config at all,
  // so the provider is left un-proxied and the user is told.
  test("skips a passthrough provider instead of emitting a keyless config", async () => {
    mockGateway([
      {
        id: "openai",
        models: ["gpt-5.5", "gpt-4o"],
        requires_client_auth: true,
      },
    ]);
    const { deps, registerProviderConfig, notify } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(registerProviderConfig).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("passthrough"),
      "warning",
    );
  });

  test("keeps registering later providers when one registration throws", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        { id: "openai", shouldCheckGatewayModels: false },
        { id: "groq", shouldCheckGatewayModels: false },
      ]),
    );
    mockGateway([
      { id: "openai", models: ["gpt-5.5"] },
      { id: "groq", models: ["llama-4"] },
    ]);
    const { deps, registerProviderConfig, notify } = configDeps(() => [
      ...openAiModels(),
      model(
        "groq",
        "llama-4",
        "openai-completions",
        "https://api.groq.com/openai/v1",
      ),
    ]);
    registerProviderConfig.mockImplementationOnce(() => {
      throw new Error("host refused");
    });

    await new ApertureRuntime().sync(deps);

    expect(registerProviderConfig.mock.calls.map(([name]) => name)).toEqual([
      "openai",
      "groq",
    ]);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("host refused"),
      "warning",
    );
  });

  test("sends the placeholder key for an override-auth provider", async () => {
    mockGateway([{ id: "openai", models: ["gpt-5.5", "gpt-4o"] }]);
    const { deps, registerProviderConfig } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(lastConfig(registerProviderConfig, "openai").apiKey).toBe("-");
  });

  test("keeps only gateway models when keepGatewayModelsOnly is on", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    mockGateway([{ id: "openai", models: ["gpt-5.5"] }]);
    const { deps, registerProviderConfig } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    const { models } = lastConfig(registerProviderConfig, "openai");
    expect(models?.map((m) => m.id)).toEqual(["gpt-5.5"]);
    // Merge-by-id cannot delete the models left out, so the filter is only
    // half-honoured here and must say so.
    expect(deps.notify).toHaveBeenCalledWith(
      expect.stringContaining("keepGatewayModelsOnly cannot hide models"),
      "warning",
    );
  });

  // Regression: the empty-selection guard used to run before both config-host
  // warnings, so the case a user most needs told about — every model filtered
  // out — was the one case that said nothing.
  test("warns before skipping a provider whose every model is filtered out", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    mockGateway([{ id: "openai", models: ["something-else"] }]);
    const { deps, registerProviderConfig, notify } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(registerProviderConfig).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("keepGatewayModelsOnly cannot hide models"),
      "warning",
    );
  });

  // Same ordering bug: a fully filtered passthrough provider skipped silently
  // instead of reporting that it cannot be proxied on this host.
  test("warns about a passthrough provider even when every model is filtered out", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    mockGateway([
      {
        id: "openai",
        models: ["something-else"],
        requires_client_auth: true,
      },
    ]);
    const { deps, registerProviderConfig, notify } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(registerProviderConfig).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("passthrough"),
      "warning",
    );
  });

  // Regression: from the second sync on, getModels() returns the models we
  // registered (gateway baseUrl), so the upstream shape must come from the
  // first-seen list, not the live one.
  test("keeps the registered catalog stable across re-syncs", async () => {
    mockGateway([{ id: "openai", models: ["gpt-5.5", "gpt-4o"] }]);
    let live = openAiModels();
    const { deps, registerProviderConfig } = configDeps(() => live);
    const runtime = new ApertureRuntime();

    await runtime.sync(deps);
    const first = lastConfig(registerProviderConfig, "openai");
    // The host now reports what we registered.
    live = (first.models ?? []).map(
      (m) => ({ ...m, provider: "openai" }) as Model<Api>,
    );
    await runtime.sync(deps);

    const second = lastConfig(registerProviderConfig, "openai");
    expect(second.models?.map((m) => m.id)).toEqual(["gpt-5.5", "gpt-4o"]);
    expect(second.baseUrl).toBe(first.baseUrl);
  });

  // The config branch is the only place a model is hand-projected, so every
  // field has to survive: a dropped contextWindow or cost silently breaks
  // token budgeting, compaction and cost display on that host.
  test("round-trips every projected model field", async () => {
    mockGateway([{ id: "openai", models: ["gpt-5.5"] }]);
    const source = {
      provider: "openai",
      id: "gpt-5.5",
      name: "GPT-5.5",
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
      reasoning: true,
      thinkingLevelMap: { low: "low", medium: "medium", high: "high" },
      input: ["text", "image"],
      cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
      contextWindow: 400_000,
      maxTokens: 128_000,
      headers: { "x-model": "1" },
      compat: { noTemperature: true },
    } as unknown as Model<Api>;
    const { deps, registerProviderConfig } = configDeps(() => [source]);

    await new ApertureRuntime().sync(deps);

    const registered = lastConfig(registerProviderConfig, "openai").models?.[0];
    expect(registered).toMatchObject({
      id: "gpt-5.5",
      name: "GPT-5.5",
      reasoning: true,
      thinkingLevelMap: source.thinkingLevelMap,
      input: ["text", "image"],
      cost: source.cost,
      contextWindow: 400_000,
      maxTokens: 128_000,
      headers: { "x-model": "1" },
      compat: source.compat,
    });
  });

  // The native branch has the same test; without it the config branch could
  // drop the upstream-URL inference and send Z.ai to `${gateway}/v1`, which
  // doubles the version segment on every request.
  test("routes a non-/v1 upstream to the gateway root", async () => {
    getConfig.mockReturnValue(
      proxyConfig([{ id: "zai", shouldCheckGatewayModels: false }]),
    );
    mockGateway([{ id: "zai", models: ["glm-4.5-air"] }]);
    const { deps, registerProviderConfig } = configDeps(() => [
      model(
        "zai",
        "glm-4.5-air",
        "openai-completions",
        "https://api.z.ai/api/coding/paas/v4",
      ),
    ]);

    await new ApertureRuntime().sync(deps);

    const config = lastConfig(registerProviderConfig, "zai");
    expect(config.baseUrl).toBe("http://gateway.test");
    expect(config.models?.[0]?.baseUrl).toBe("http://gateway.test");
  });

  test("applies a per-provider api override and its base url", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          api: "anthropic-messages",
        },
      ]),
    );
    mockGateway([
      {
        id: "openai",
        models: ["gpt-5.5", "gpt-4o"],
        compatibility: { anthropic_messages: true },
      },
    ]);
    const { deps, registerProviderConfig } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    const config = lastConfig(registerProviderConfig, "openai");
    expect(config.models?.map((m) => m.api)).toEqual([
      "anthropic-messages",
      "anthropic-messages",
    ]);
    // Base URL and api must agree, or the request is mis-routed.
    expect(config.baseUrl).toBe("http://gateway.test");
    expect(
      config.models?.every((m) => m.baseUrl === "http://gateway.test"),
    ).toBe(true);
  });

  // A provider can span APIs; the native branch preserves each model's own
  // `api`, so the config branch must not stamp the first model's onto all.
  test("preserves each model's own api", async () => {
    mockGateway([{ id: "openai", models: ["gpt-5.5", "gpt-3.5-turbo"] }]);
    const { deps, registerProviderConfig } = configDeps(() => [
      model(
        "openai",
        "gpt-5.5",
        "openai-responses",
        "https://api.openai.com/v1",
      ),
      model(
        "openai",
        "gpt-3.5-turbo",
        "openai-completions",
        "https://api.openai.com/v1",
      ),
    ]);

    await new ApertureRuntime().sync(deps);

    expect(
      lastConfig(registerProviderConfig, "openai").models?.map((m) => m.api),
    ).toEqual(["openai-responses", "openai-completions"]);
  });

  // Mutation cover: without this, `api: modelApi` could keep the per-model
  // api while `baseUrl` reverted to the provider-wide one and every test
  // still passed, because the two only disagree across API families.
  test("derives each model's base url from that model's own api", async () => {
    mockGateway([{ id: "openai", models: ["gpt-5.5", "claude-ish"] }]);
    const { deps, registerProviderConfig } = configDeps(() => [
      model(
        "openai",
        "gpt-5.5",
        "openai-responses",
        "https://api.openai.com/v1",
      ),
      model(
        "openai",
        "claude-ish",
        "anthropic-messages",
        "https://api.openai.com/v1",
      ),
    ]);

    await new ApertureRuntime().sync(deps);

    // `openai-responses` keeps `/v1`; `anthropic-messages` needs the root
    // because the Anthropic SDK appends `/v1/messages` itself.
    expect(
      lastConfig(registerProviderConfig, "openai").models?.map(
        (m) => m.baseUrl,
      ),
    ).toEqual(["http://gateway.test/v1", "http://gateway.test"]);
  });

  // Mutation cover: the warning must be conditional, not unconditional.
  test("stays quiet when keepGatewayModelsOnly filters nothing", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "openai",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
    );
    mockGateway([{ id: "openai", models: ["gpt-5.5", "gpt-4o"] }]);
    const { deps, registerProviderConfig, notify } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(lastConfig(registerProviderConfig, "openai").models).toHaveLength(2);
    expect(notify).not.toHaveBeenCalled();
  });

  // Regression: a config registration outlives the sync that made it, so a
  // provider that becomes passthrough later has to be actively undone. Merely
  // skipping it leaves the gateway registration installed with `apiKey: "-"`
  // and every request failing the upstream's own auth.
  test("unregisters a provider that becomes passthrough after being rerouted", async () => {
    mockGateway([{ id: "openai", models: ["gpt-5.5", "gpt-4o"] }]);
    const { deps, registerProviderConfig, unregisterProvider, notify } =
      configDeps(openAiModels);
    const runtime = new ApertureRuntime();

    await runtime.sync(deps);
    expect(registerProviderConfig).toHaveBeenCalledTimes(1);
    expect(unregisterProvider).not.toHaveBeenCalled();

    // The gateway flips the provider to passthrough.
    mockGateway([
      {
        id: "openai",
        models: ["gpt-5.5", "gpt-4o"],
        requires_client_auth: true,
      },
    ]);
    await runtime.sync(deps);

    expect(unregisterProvider).toHaveBeenCalledWith("openai");
    expect(registerProviderConfig).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("restored its own routing"),
      "warning",
    );
  });

  // Without a catalog there is no evidence a provider is not passthrough, and
  // guessing wrong sends `Bearer -` where the user's own credential belongs.
  test("registers nothing when the gateway catalog is unreachable", async () => {
    mockGateway(new Error("gateway down"));
    const { deps, registerProviderConfig, notify } = configDeps(openAiModels);

    await new ApertureRuntime().sync(deps);

    expect(registerProviderConfig).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("could not reach the gateway catalog"),
      "warning",
    );
  });
});
