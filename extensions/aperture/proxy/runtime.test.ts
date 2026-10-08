import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, CredentialStore } from "@earendil-works/pi-ai";
import * as completionsAdapter from "@earendil-works/pi-ai/api/openai-completions";
import * as responsesAdapter from "@earendil-works/pi-ai/api/openai-responses";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import {
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApertureClient } from "../../../src/api/client";
import { shouldUseGatewayRoot } from "../../../src/base-url-routing";
import { configLoader } from "../../shared/config/loader";
import type { ResolvedConfig } from "../../shared/config/types";
import type { Api, Model, SyncDeps } from "../../shared/types";
import { ApertureRuntime } from "./runtime";

vi.mock("../../shared/config/loader", () => ({
  configLoader: {
    getConfig: vi.fn(),
  },
}));

vi.mock("../../../src/api/client", () => ({
  ApertureClient: vi.fn(),
}));

const gatewayUrl = "http://gateway.test";
const getConfig = vi.mocked(configLoader.getConfig);

function model(
  provider: string,
  id: string,
  api?: Api,
  baseUrl?: string,
): Model<Api> {
  return { provider, id, api, baseUrl } as Model<Api>;
}

// Fake upstream stream following the pi-ai adapter contract: the recorded
// AssistantMessage carries the request model id (`model: model.id`).
function doneStream(m: Model<Api>) {
  const message = {
    role: "assistant",
    content: [],
    api: m.api,
    provider: m.provider,
    model: m.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  } as AssistantMessage;
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

// Builds SyncDeps whose getProvider returns a fake native provider backed by
// the supplied models, and records native re-registrations so tests can assert
// on the wrapped provider's rewritten getModels() baseUrl.
function syncDeps(models: () => Model<Api>[]) {
  const registerNativeProvider = vi.fn();
  const store = new Map<
    string,
    { getModels: () => Model<Api>[]; getAllModels?: () => Model<Api>[] }
  >();
  const deps = {
    getProvider: (id: string) => {
      if (!store.has(id)) {
        store.set(id, {
          getModels: () =>
            models().filter(
              (m) =>
                m.provider === id &&
                ((m as { type?: string }).type ?? "chat") === "chat",
            ),
          getAllModels: () => models().filter((m) => m.provider === id),
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
    getModels: models,
  };
  return { deps, registerNativeProvider };
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

function mockCatalog(list: ReturnType<typeof provider>[]) {
  vi.mocked(ApertureClient).mockImplementation(function (this: {
    providers: ReturnType<typeof vi.fn>;
  }) {
    this.providers = vi.fn().mockResolvedValue(list);
    return this;
  } as unknown as typeof ApertureClient);
}

function proxyConfig(
  upstreamProviders: {
    id: string;
    gatewayId?: string;
    enabled?: boolean;
    shouldCheckGatewayModels: boolean;
    keepGatewayModelsOnly?: boolean;
    api?: string;
  }[],
) {
  return {
    baseUrl: gatewayUrl,
    onboardingDone: true,
    onboarding: { enabled: false },
    proxy: {
      enabled: true,
      upstreamProviders: upstreamProviders.map((p) => ({
        ...p,
        gatewayId: p.gatewayId ?? p.id,
      })),
    },
    dedicated: { enabled: false, providers: [] },
    mcp: { enabled: false },
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
    mockCatalog([
      provider("anthropic", []),
      provider("openai", []),
      provider("openai-codex", []),
    ]);
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
      gatewayUrl,
    );
    expect(wrappedBaseUrl(registerNativeProvider, "openai")).toBe(
      `${gatewayUrl}/v1`,
    );
    expect(wrappedBaseUrl(registerNativeProvider, "openai-codex")).toBe(
      gatewayUrl,
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
    mockCatalog([
      provider("zai", []),
      provider("openai", []),
      provider("groq", []),
    ]);
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

    expect(wrappedBaseUrl(registerNativeProvider, "zai")).toBe(gatewayUrl);
    expect(wrappedBaseUrl(registerNativeProvider, "openai")).toBe(
      `${gatewayUrl}/v1`,
    );
    expect(wrappedBaseUrl(registerNativeProvider, "groq")).toBe(
      `${gatewayUrl}/v1`,
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
        model("zai", "glm-4.5-air", "openai-completions", gatewayUrl),
      ],
    });

    const zaiCalls = registerNativeProvider.mock.calls.filter(
      ([p]: unknown[]) => (p as { id?: string }).id === "zai",
    );
    expect(zaiCalls).toHaveLength(2);
    for (const [p] of zaiCalls) {
      expect(
        (p as { getModels: () => Model<Api>[] }).getModels()[0].baseUrl,
      ).toBe(gatewayUrl);
    }
  });
});

describe("ApertureRuntime.sync fixed-path APIs", () => {
  test("routes a proxied Bedrock provider through /bedrock, not /v1", async () => {
    mockCatalog([provider("bedrock", [])]);
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
    mockCatalog([provider("google", [])]);
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
    mockCatalog([
      provider("synthetic", []),
      provider("google", []),
      provider("openai-codex", []),
    ]);
    getConfig.mockReturnValue(
      proxyConfig([{ id: "synthetic", shouldCheckGatewayModels: false }]),
    );
  });

  test("getModels() keeps bare ids while stream dispatch rewrites them", async () => {
    const stream = vi.fn().mockImplementation(doneStream);
    const streamSimple = vi.fn().mockImplementation(doneStream);
    const native = {
      id: "synthetic",
      getModels: () => [model("synthetic", "foo")],
      stream,
      streamSimple,
    };
    const registerNativeProvider = vi.fn();
    const deps = {
      getProvider: vi.fn().mockReturnValue(native),
      registerNativeProvider,
      getModels: () => [model("synthetic", "foo")],
    };

    await new ApertureRuntime().sync(deps);

    const wrapped = (
      registerNativeProvider.mock.calls[0] as [typeof native]
    )[0];
    const bareModel = model("synthetic", "foo");
    expect(wrapped.getModels().map((m) => m.id)).toEqual(["foo"]);

    const context = {} as never;
    const streamed = await wrapped
      .stream(bareModel, context, undefined)
      .result();
    expect(streamed.model).toBe("foo");
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      provider: "synthetic",
      id: "synthetic/foo",
    });

    stream.mockClear();
    const simple = await wrapped
      .streamSimple(bareModel, context, undefined)
      .result();
    expect(simple.model).toBe("foo");
    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      provider: "synthetic",
      id: "synthetic/foo",
    });

    // The original model object must not be mutated by the rewrite.
    expect(bareModel.id).toBe("foo");
  });

  // Path-embedding APIs (Gemini/Vertex/Bedrock) put the model id in the
  // URL, which the gateway forwards verbatim upstream; qualifying it 404s.
  // Stream dispatch must keep the bare id for those APIs.
  test("stream dispatch keeps bare ids for path-embedding APIs", async () => {
    const stream = vi.fn().mockImplementation(doneStream);
    const streamSimple = vi.fn().mockImplementation(doneStream);
    const native = {
      id: "google",
      getModels: () => [
        model("google", "gemini-2.5-pro", "google-generative-ai"),
      ],
      stream,
      streamSimple,
    };
    const registerNativeProvider = vi.fn();
    getConfig.mockReturnValue(
      proxyConfig([{ id: "google", shouldCheckGatewayModels: false }]),
    );
    const deps = {
      getProvider: vi.fn().mockReturnValue(native),
      registerNativeProvider,
      getModels: () => [
        model("google", "gemini-2.5-pro", "google-generative-ai"),
      ],
    };

    await new ApertureRuntime().sync(deps);

    const wrapped = (
      registerNativeProvider.mock.calls[0] as [typeof native]
    )[0];
    const context = {} as never;
    const geminiModel = model(
      "google",
      "gemini-2.5-pro",
      "google-generative-ai",
    );

    wrapped.stream(geminiModel, context, undefined);
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      provider: "google",
      id: "gemini-2.5-pro",
    });

    wrapped.streamSimple(geminiModel, context, undefined);
    expect(streamSimple.mock.calls[0]?.[0]).toMatchObject({
      provider: "google",
      id: "gemini-2.5-pro",
    });
  });

  // Regression: from the second sync onwards, deps.getProvider returns our own
  // previous wrapper. Routing stream/streamSimple through `native` (the
  // wrapper) double-qualifies; delegate through the first-seen provider.
  test("stream dispatch does not double-qualify across re-syncs", async () => {
    const stream = vi.fn().mockImplementation(doneStream);
    const streamSimple = vi.fn().mockImplementation(doneStream);
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
      getProvider: (id: string) => store.get(id),
      registerNativeProvider: (p: { id: string }) => void store.set(p.id, p),
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

  test("refreshModels stays anchored to the original provider after Pi recomposes the wrapper", async () => {
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi
        .fn()
        .mockResolvedValue([provider("anthropic", ["claude-test"])]);
      return this;
    } as unknown as typeof ApertureClient);
    getConfig.mockReturnValue(
      proxyConfig([{ id: "anthropic", shouldCheckGatewayModels: false }]),
    );
    const refreshModels = vi.fn().mockResolvedValue(undefined);
    const native = {
      id: "anthropic",
      getModels: () => [
        model("anthropic", "claude-test", "anthropic-messages"),
      ],
      auth: { apiKey: { resolve: vi.fn() } },
      refreshModels,
    };
    let current: typeof native = native;
    const deps = {
      getProvider: () => current,
      registerNativeProvider: (base: typeof native) => {
        current = {
          ...base,
          refreshModels: async (context: never) => {
            await base.refreshModels(context);
          },
        };
      },
      getModels: () => native.getModels(),
    };

    const runtime = new ApertureRuntime();
    await runtime.sync(deps as never);
    await current.refreshModels({} as never);
    await runtime.sync(deps as never);
    await current.refreshModels({} as never);

    expect(refreshModels).toHaveBeenCalledTimes(2);
  });

  // `/reload` re-runs the factory with a fresh ApertureRuntime but keeps Pi's
  // ModelRuntime (and the wrapper in it), so the fresh runtime wraps the stale
  // wrapper. Spy the real openai-codex provider's stream and assert the model
  // id it receives gains no extra prefix across reloads.
  test("stream stays single-prefixed across reloads", async () => {
    const providerId = "openai-codex";
    getConfig.mockReturnValue(
      proxyConfig([{ id: providerId, shouldCheckGatewayModels: false }]),
    );
    const registry = await ModelRuntime.create({
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const deps: SyncDeps = {
      getProvider: (id) => registry.getProvider(id),
      registerNativeProvider: (p) => registry.registerNativeProvider(p),
      getModels: () => [...registry.getModels()],
    };

    const codex = () => {
      const provider = registry.getProvider(providerId);
      if (!provider) {
        throw "Missing provider";
      }
      return provider;
    };

    const upstream = codex().getModels()[0].baseUrl;
    const initialModel = { ...codex().getModels()[0] };

    const spy = vi.spyOn(codex(), "stream");

    // First stream call: replaces the base url and the prefixes the modelId.
    await new ApertureRuntime().sync(deps);
    codex().stream(codex().getModels()[0], {} as never, {} as never);

    expect(codex().getModels()[0].baseUrl).toBe(gatewayUrl);
    expect(codex().getModels()[0].baseUrl).not.toBe(upstream);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: `${providerId}/${initialModel.id}` }),
      {},
      {},
    );

    spy.mockClear();

    // Following stream calls: doesn't re-apply the prefixes to the modelId.
    await new ApertureRuntime().sync(deps);
    codex().stream(codex().getModels()[0], {} as never, {} as never);

    expect(codex().getModels()[0].baseUrl).toBe(gatewayUrl);
    expect(codex().getModels()[0].baseUrl).not.toBe(upstream);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: `${providerId}/${initialModel.id}` }),
      {},
      {},
    );

    spy.mockClear();

    await new ApertureRuntime().sync(deps);
    codex().stream(codex().getModels()[0], {} as never, {} as never);

    expect(codex().getModels()[0].baseUrl).toBe(gatewayUrl);
    expect(codex().getModels()[0].baseUrl).not.toBe(upstream);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ id: `${providerId}/${initialModel.id}` }),
      {},
      {},
    );
  });
});

describe("ApertureRuntime.sync OpenAI passthrough transport", () => {
  const upstreamUrl = "https://api.openai.com/v1";

  async function setup({
    requiresClientAuth = true,
    api = "openai-responses" as Api,
    baseUrl = upstreamUrl,
    gatewayId = "openai-subscription",
  } = {}) {
    mockCatalog([
      {
        ...provider(gatewayId, ["gpt-6-sol"]),
        requires_client_auth: requiresClientAuth,
      },
    ]);
    getConfig.mockReturnValue({
      ...proxyConfig([
        {
          id: "openai",
          gatewayId,
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
        },
      ]),
      baseUrl: "https://ai.pango-lin.ts.net",
    });
    const native = {
      id: "openai",
      getModels: () => [model("openai", "gpt-6-sol", api, baseUrl)],
      auth: { apiKey: { resolve: vi.fn() } },
      stream: vi.fn().mockImplementation(doneStream),
      streamSimple: vi.fn().mockImplementation(doneStream),
    };
    let current = native;
    const deps = {
      getModels: () => current.getModels(),
      getProvider: () => current,
      registerNativeProvider: (p: typeof native) => {
        current = p;
      },
    };
    const runtime = new ApertureRuntime();
    await runtime.sync(deps);
    return { native, wrapped: () => current, runtime, deps };
  }

  test.each([
    "stream",
    "streamSimple",
  ] as const)("%s preserves the native URL and auth while qualifying mapped model ids", async (method) => {
    const { native, wrapped } = await setup();
    const fetch = vi.fn().mockResolvedValue(new Response());
    const options = {
      apiKey: "subscription-token",
      fetch,
      signal: new AbortController().signal,
      headers: { "x-session-id": "session-1" },
    };
    const proxied = wrapped();
    expect(proxied.getModels()[0].baseUrl).toBe(upstreamUrl);
    expect(proxied.getModels()[0].id).toBe("gpt-6-sol");
    expect(proxied.auth).toBe(native.auth);

    proxied[method](proxied.getModels()[0], {} as never, options);
    const [sentModel, , sentOptions] = native[method].mock.calls[0];
    expect(sentModel).toMatchObject({
      id: "openai-subscription/gpt-6-sol",
      provider: "openai",
      baseUrl: upstreamUrl,
    });
    expect(sentOptions).toMatchObject({
      apiKey: options.apiKey,
      signal: options.signal,
      headers: options.headers,
    });
    expect(options.fetch).toBe(fetch);
    await sentOptions.fetch(`${upstreamUrl}/responses`);
    expect(fetch).toHaveBeenCalledWith(
      new URL("https://ai.pango-lin.ts.net/v1/responses"),
      undefined,
    );
  });

  test.each([
    { requiresClientAuth: false },
    { api: "openai-completions" as Api },
    { baseUrl: "https://api.openai.com/v1/" },
    { baseUrl: "https://other.example.test/v1" },
  ])("keeps URL rewriting outside the exact passthrough Responses route: %j", async (settings) => {
    const { native, wrapped } = await setup(settings);
    const options = { apiKey: "sk-test", fetch: vi.fn() };
    const proxied = wrapped();
    expect(proxied.getModels()[0].baseUrl).toBe(
      "https://ai.pango-lin.ts.net/v1",
    );
    proxied.stream(proxied.getModels()[0], {} as never, options);
    expect(native.stream.mock.calls[0][2]).toBe(options);
  });

  test("keeps native URLs and a single transport wrapper across re-syncs", async () => {
    const { native, wrapped, runtime, deps } = await setup();
    await runtime.sync(deps);
    const proxied = wrapped();
    expect(proxied.getModels()[0].baseUrl).toBe(upstreamUrl);
    proxied.streamSimple(proxied.getModels()[0], {} as never, undefined);
    expect(native.streamSimple).toHaveBeenCalledOnce();
    expect(native.streamSimple.mock.calls[0][0].id).toBe(
      "openai-subscription/gpt-6-sol",
    );
    expect(native.streamSimple.mock.calls[0][2].fetch).toBeTypeOf("function");
  });

  test.each([
    "subscription-token",
    "sk-test",
  ])("lets Pi build the same body as a direct request for credential %s", async (apiKey) => {
    const { native, wrapped } = await setup();
    const fetch = vi.fn().mockResolvedValue(
      new Response('{"error":{"message":"test stop"}}', {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    const options = {
      apiKey,
      fetch,
      maxTokens: 128,
      temperature: 0.5,
      cacheRetention: "long" as const,
      sessionId: "session-1",
      maxRetries: 0,
    };
    const context = { messages: [] };
    const directModel = {
      ...native.getModels()[0],
      reasoning: false,
      input: ["text"],
      maxTokens: 128,
    } as Model<"openai-responses">;
    await responsesAdapter.stream(directModel, context, options).result();
    const directBody = JSON.parse(fetch.mock.calls[0][1].body);
    expect(String(fetch.mock.calls[0][0])).toBe(`${upstreamUrl}/responses`);

    const proxied = wrapped();
    proxied.stream(proxied.getModels()[0], context, options);
    const [sentModel, , sentOptions] = native.stream.mock.calls[0];
    await responsesAdapter
      .stream({ ...directModel, ...sentModel }, context, sentOptions)
      .result();
    const proxyBody = JSON.parse(fetch.mock.calls[1][1].body);
    expect(String(fetch.mock.calls[1][0])).toBe(
      "https://ai.pango-lin.ts.net/v1/responses",
    );
    // Compare with Pi's own body rather than copying its subscription rules.
    // This regression works both before and after Pi's ChatGPT support.
    expect(proxyBody).toEqual({
      ...directBody,
      model: "openai-subscription/gpt-6-sol",
    });
  });
});

describe("ApertureRuntime.sync session model restore", () => {
  // The proxy qualifies request model ids with the gateway id; pi-ai stamps
  // that id onto the recorded AssistantMessage (`model: model.id`), and Pi
  // restores a session from the last assistant message's { provider, model }.
  // If the qualified id leaks into the session file, resume warns
  // "Could not restore model anthropic/anthropic-oauth/claude-opus-5-5".
  test("the model id recorded in the session file resolves on restore", async () => {
    mockCatalog([provider("anthropic-oauth", ["claude-opus-5-5"])]);
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "anthropic",
          gatewayId: "anthropic-oauth",
          shouldCheckGatewayModels: false,
        },
      ]),
    );
    const claude = model("anthropic", "claude-opus-5-5", "anthropic-messages");
    const native = {
      id: "anthropic",
      getModels: () => [claude],
      stream: doneStream,
      streamSimple: doneStream,
    };
    const registerNativeProvider = vi.fn();

    await new ApertureRuntime().sync({
      getProvider: () => native,
      registerNativeProvider,
      getModels: () => [claude],
    });
    const wrapped = (
      registerNativeProvider.mock.calls.at(-1) as [typeof native]
    )[0];

    const recorded = await wrapped
      .stream(claude, {} as never, undefined)
      .result();

    const dir = mkdtempSync(join(tmpdir(), "aperture-session-"));
    const session = SessionManager.create(dir, dir);
    session.appendMessage(recorded);
    const file = session.getSessionFile();
    expect(file).toBeDefined();

    // Mirror Pi's resume: last assistant message's { provider, model } is
    // resolved against the registered models.
    const restored = SessionManager.open(file as string);
    const lastAssistant = restored
      .getEntries()
      .filter(
        (entry) =>
          entry.type === "message" && entry.message.role === "assistant",
      )
      .at(-1);
    const saved =
      lastAssistant?.type === "message" &&
      lastAssistant.message.role === "assistant"
        ? {
            provider: lastAssistant.message.provider,
            modelId: lastAssistant.message.model,
          }
        : undefined;
    expect(saved).toEqual({
      provider: "anthropic",
      modelId: "claude-opus-5-5",
    });
  });
});

describe("ApertureRuntime.sync reasoning replay", () => {
  test.each([
    ["stream", false, "reasoning"],
    ["streamSimple", false, "reasoning"],
    ["stream", false, "reasoning_content"],
    ["streamSimple", false, "reasoning_content"],
    ["stream", true, "reasoning"],
    ["streamSimple", true, "reasoning"],
    ["stream", true, "reasoning_content"],
    ["streamSimple", true, "reasoning_content"],
  ] as const)("%s with API override %s replays %s", async (method, override, field) => {
    const local = {
      ...model("local-provider", "kimi-k3", "openai-completions"),
      input: ["text"],
      reasoning: true,
      maxTokens: 128,
      compat: { requiresThinkingAsText: false },
    } as Model<"openai-completions">;
    mockCatalog([
      {
        ...provider("gateway-provider", [local.id]),
        compatibility: { openai_chat: true },
      },
    ]);
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: local.provider,
          gatewayId: "gateway-provider",
          shouldCheckGatewayModels: false,
          api: override ? "openai-completions" : undefined,
        },
      ]),
    );
    const native = {
      id: local.provider,
      getModels: () => [local],
      stream: completionsAdapter.stream,
      streamSimple: completionsAdapter.streamSimple,
    };
    const registerNativeProvider = vi.fn();
    await new ApertureRuntime().sync({
      getProvider: () => native,
      registerNativeProvider,
      getModels: () => [local],
    });
    const wrapped = registerNativeProvider.mock.calls.at(-1)?.[0];
    const first = await doneStream(local).result();
    first.content = [
      {
        type: "thinking",
        thinking: "prior reasoning",
        thinkingSignature: field,
      },
      { type: "text", text: "prior answer" },
    ];
    Object.freeze(first);
    const context = normalizeContext({
      systemPrompt: "Keep reasoning separate.",
      messages: [first, { role: "user", content: "Continue", timestamp: 1 }],
    });
    const snapshot = structuredClone(context);
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        'data: {"choices":[{"delta":{"content":"next answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        {
          headers: { "content-type": "text/event-stream" },
        },
      ),
    );

    const second = await wrapped[method](local, context, {
      apiKey: "-",
      fetch,
      maxRetries: 0,
    }).result();

    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    expect(payload.model).toBe("gateway-provider/kimi-k3");
    expect(
      payload.messages.find((m: { role: string }) => m.role === "assistant"),
    ).toMatchObject({
      content: "prior answer",
      [field]: "prior reasoning",
    });
    expect(second.stopReason).toBe("stop");
    expect(second.model).toBe(local.id);
    expect(context).toEqual(snapshot);
    expect(first.model).toBe(local.id);
    expect(wrapped.getModels()[0].id).toBe(local.id);
  });
});

describe("ApertureRuntime.sync provider composition with models.json", () => {
  test("the catalog Pi serves after registration keeps the gateway base URL", async () => {
    const dir = mkdtempSync(join(tmpdir(), "aperture-composition-"));
    writeFileSync(
      join(dir, "models.json"),
      JSON.stringify({
        providers: {
          anthropic: { compat: { sendSessionAffinityHeaders: true } },
        },
      }),
    );
    const credentials: CredentialStore = {
      read: async (id) =>
        id === "anthropic"
          ? {
              type: "oauth",
              access: "test-access",
              refresh: "test-refresh",
              expires: Date.now() + 3_600_000,
            }
          : undefined,
      list: async () => [{ providerId: "anthropic", type: "oauth" }],
      modify: async (id, mutate) => {
        const current = await credentials.read(id);
        return mutate(current);
      },
      delete: async () => {},
    };
    const runtime = await ModelRuntime.create({
      credentials,
      modelsPath: join(dir, "models.json"),
      refreshOnCreate: false,
    });
    const registry = new ModelRegistry(runtime);
    const claude = runtime
      .getModels("anthropic")
      .find((candidate) => candidate.api === "anthropic-messages");
    if (!claude) throw new Error("no anthropic-messages model in the catalog");

    mockCatalog([provider("anthropic-oauth", [claude.id])]);
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "anthropic",
          gatewayId: "anthropic-oauth",
          shouldCheckGatewayModels: false,
        },
      ]),
    );

    await new ApertureRuntime().sync({
      getProvider: (id) => registry.getProvider(id),
      registerNativeProvider: (wrapped) => registry.registerProvider(wrapped),
      getModels: () => registry.getAll(),
    });

    const wrapper = registry.getRegisteredNativeProvider("anthropic");
    expect(wrapper?.getModels()[0]?.baseUrl).toBe(gatewayUrl);
    expect(runtime.getModel("anthropic", claude.id)?.baseUrl).toBe(gatewayUrl);
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
          gatewayId: typeof p === "string" ? p : p.id,
        })),
      },
      dedicated: { enabled: false, providers: [] },
      mcp: { enabled: false },
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
    expect(notify).not.toHaveBeenCalled();
  });

  test("stream dispatch routes an override through the api registry, not the upstream provider", async () => {
    // With an override the gateway owns the protocol translation, so streams
    // go through the api registry (dedicated-style). Delegating would hand
    // the rewritten model to upstream stream layers pinned to their own api
    // entry, which reject such models with `Mismatched api: ...`.
    const firstSeenStream = vi.fn();
    const firstSeenStreamSimple = vi.fn();
    const native = {
      id: "neuralwatt",
      getModels: () => [
        model(
          "neuralwatt",
          "kimi-k3",
          "openai-completions",
          "https://api.neuralwatt.com/v1",
        ),
      ],
      stream: firstSeenStream,
      streamSimple: firstSeenStreamSimple,
    };
    const registerNativeProvider = vi.fn();
    const deps = {
      getProvider: vi.fn().mockReturnValue(native),
      registerNativeProvider,
      getModels: () => native.getModels(),
    };

    await new ApertureRuntime().sync(deps);

    const wrapped = (
      registerNativeProvider.mock.calls.at(-1) as [typeof native]
    )[0];
    const overridden = { ...wrapped.getModels()[0] };
    expect(overridden.api).toBe("anthropic-messages");

    // Registry dispatch must not throw synchronously and must not reach the
    // pinned upstream stream layer.
    expect(() =>
      wrapped.streamSimple(overridden, {} as never, undefined),
    ).not.toThrow();
    expect(() =>
      wrapped.stream(overridden, {} as never, undefined),
    ).not.toThrow();
    expect(firstSeenStreamSimple).not.toHaveBeenCalled();
    expect(firstSeenStream).not.toHaveBeenCalled();
  });

  test("stream dispatch delegates to the upstream provider without an override", async () => {
    mockCatalog([provider("groq", [])]);
    const firstSeenStreamSimple = vi.fn().mockImplementation(doneStream);
    const native = {
      id: "groq",
      getModels: () => [
        model(
          "groq",
          "llama-4",
          "openai-completions",
          "https://api.groq.com/openai/v1",
        ),
      ],
      stream: vi.fn().mockImplementation(doneStream),
      streamSimple: firstSeenStreamSimple,
    };
    const registerNativeProvider = vi.fn();
    getConfig.mockReturnValue(
      proxyConfig([{ id: "groq", shouldCheckGatewayModels: false }]),
    );
    const deps = {
      getProvider: vi.fn().mockReturnValue(native),
      registerNativeProvider,
      getModels: () => native.getModels(),
    };

    await new ApertureRuntime().sync(deps);

    const wrapped = (
      registerNativeProvider.mock.calls.at(-1) as [typeof native]
    )[0];
    const served = { ...wrapped.getModels()[0] };
    expect(served.api).toBe("openai-completions");

    wrapped.streamSimple(served, {} as never, undefined);
    expect(firstSeenStreamSimple).toHaveBeenCalledOnce();
    expect(firstSeenStreamSimple.mock.calls[0]?.[0]).toMatchObject({
      provider: "groq",
      id: "groq/llama-4",
    });
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

describe("ApertureRuntime stale context", () => {
  function staleDeps() {
    let invalidated = false;
    const staleError = () => {
      throw new Error(
        "This extension ctx is stale after session replacement or reload.",
      );
    };
    return {
      invalidate: () => {
        invalidated = true;
      },
      deps: {
        getProvider: () => {
          if (invalidated) staleError();
          return undefined;
        },
        registerNativeProvider: () => {
          if (invalidated) staleError();
        },
        getModels: () => {
          if (invalidated) staleError();
          return [];
        },
        isStale: () => invalidated,
      } satisfies SyncDeps,
    };
  }

  beforeEach(() => {
    getConfig.mockReturnValue(
      proxyConfig([{ id: "openrouter", shouldCheckGatewayModels: true }]),
    );
  });

  test("sync bails after the catalog fetch when the session was replaced", async () => {
    let release: ((providers: unknown) => void) | undefined;
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      return this;
    } as unknown as typeof ApertureClient);
    const { deps, invalidate } = staleDeps();

    const pending = new ApertureRuntime().sync(deps);
    invalidate();
    release?.([]);

    await expect(pending).resolves.toBeUndefined();
  });

  test("checkMissingModels bails after the catalog fetch when the session was replaced", async () => {
    let release: ((providers: unknown) => void) | undefined;
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi.fn(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      return this;
    } as unknown as typeof ApertureClient);
    const notify = vi.fn();
    const { deps, invalidate } = staleDeps();

    const pending = new ApertureRuntime().checkMissingModels({
      getModels: deps.getModels,
      notify,
      isStale: deps.isStale,
    });
    invalidate();
    release?.([provider("openrouter", ["or-1"])]);

    await expect(pending).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
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
      stream: vi.fn().mockImplementation(doneStream),
      streamSimple: vi.fn().mockImplementation(doneStream),
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
        getProvider: (id: string) => natives[id],
        registerNativeProvider,
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
      getProvider: () => current,
      registerNativeProvider,
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

describe("ApertureRuntime.sync manual gateway mapping", () => {
  test("qualifies mapped model ids with the gateway id and keeps local registry ids", async () => {
    mockCatalog([provider("anthropic-oauth", ["claude"])]);
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "anthropic",
          gatewayId: "anthropic-oauth",
          shouldCheckGatewayModels: false,
        },
      ]),
    );
    const stream = vi.fn().mockImplementation(doneStream);
    const native = {
      id: "anthropic",
      getModels: () => [model("anthropic", "claude", "anthropic-messages")],
      stream,
      streamSimple: vi.fn().mockImplementation(doneStream),
    };
    const registerNativeProvider = vi.fn();
    await new ApertureRuntime().sync({
      getModels: native.getModels,
      getProvider: () => native,
      registerNativeProvider,
    });
    const wrapped = registerNativeProvider.mock.calls.at(
      -1,
    )?.[0] as typeof native;
    expect(wrapped.id).toBe("anthropic");
    expect(wrapped.getModels()[0].id).toBe("claude");
    wrapped.stream(wrapped.getModels()[0], {} as never);
    expect(stream.mock.calls[0]?.[0]).toMatchObject({
      provider: "anthropic",
      id: "anthropic-oauth/claude",
    });
  });

  test("uses mapped target for model filtering, API validation and many-to-one routes", async () => {
    mockCatalog([
      {
        ...provider("shared", ["m-1"]),
        compatibility: { anthropic_messages: true },
      },
    ]);
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "first",
          gatewayId: "shared",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: true,
          api: "anthropic-messages",
        },
        {
          id: "second",
          gatewayId: "shared",
          shouldCheckGatewayModels: false,
          keepGatewayModelsOnly: false,
        },
      ]),
    );
    const { deps, registerNativeProvider } = syncDeps(() => [
      model("first", "m-1", "openai-completions"),
      model("first", "missing", "openai-completions"),
      model("second", "m-1", "openai-completions"),
      model("second", "missing", "openai-completions"),
    ]);
    await new ApertureRuntime().sync(deps);
    const registered = registerNativeProvider.mock.calls.map(
      ([p]) => p as { id: string; getModels: () => Model<Api>[] },
    );
    expect(registered.map((p) => p.id)).toEqual(["first", "second"]);
    expect(registered[0].getModels().map((m) => [m.id, m.api])).toEqual([
      ["m-1", "anthropic-messages"],
    ]);
    expect(registered[1].getModels().map((m) => m.id)).toEqual([
      "m-1",
      "missing",
    ]);
  });

  test("keeps native auth when mapped target requires client auth", async () => {
    mockCatalog([
      {
        ...provider("anthropic-oauth", ["claude"]),
        requires_client_auth: true,
      },
    ]);
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "anthropic",
          gatewayId: "anthropic-oauth",
          shouldCheckGatewayModels: false,
        },
      ]),
    );
    const auth = { apiKey: { resolve: vi.fn() } };
    const native = {
      id: "anthropic",
      auth,
      getModels: () => [model("anthropic", "claude", "anthropic-messages")],
      stream: vi.fn().mockImplementation(doneStream),
      streamSimple: vi.fn().mockImplementation(doneStream),
    };
    const registerNativeProvider = vi.fn();
    await new ApertureRuntime().sync({
      getModels: native.getModels,
      getProvider: () => native,
      registerNativeProvider,
    });
    expect(registerNativeProvider.mock.calls.at(-1)?.[0].auth).toBe(auth);
  });

  test("retains mapped passthrough auth during a later catalog failure", async () => {
    mockCatalog([
      { ...provider("oauth-target", ["m-1"]), requires_client_auth: true },
    ]);
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "local",
          gatewayId: "oauth-target",
          shouldCheckGatewayModels: false,
        },
      ]),
    );
    const auth = { apiKey: { resolve: vi.fn() } };
    const native = {
      id: "local",
      auth,
      getModels: () => [model("local", "m-1")],
      stream: vi.fn().mockImplementation(doneStream),
      streamSimple: vi.fn().mockImplementation(doneStream),
    };
    let current: typeof native = native;
    const registerNativeProvider = vi.fn((provider: typeof native) => {
      current = provider;
    });
    const deps = {
      getModels: native.getModels,
      getProvider: () => current,
      registerNativeProvider,
    };
    const runtime = new ApertureRuntime();
    await runtime.sync(deps);
    vi.mocked(ApertureClient).mockImplementation(function (this: {
      providers: ReturnType<typeof vi.fn>;
    }) {
      this.providers = vi.fn().mockRejectedValue(new Error("offline"));
      return this;
    } as unknown as typeof ApertureClient);
    await runtime.sync(deps);
    expect(current.auth).toBe(auth);
  });

  test("unknown target restores native after provisional registration and warns once per sync", async () => {
    mockCatalog([provider("known", [])]);
    getConfig.mockReturnValue(
      proxyConfig([
        { id: "first", gatewayId: "gone", shouldCheckGatewayModels: false },
        { id: "second", gatewayId: "gone", shouldCheckGatewayModels: false },
      ]),
    );
    const natives = new Map(
      ["first", "second"].map((id) => [
        id,
        {
          id,
          getModels: () => [model(id, "m-1")],
          auth: { apiKey: { resolve: vi.fn() } },
          stream: vi.fn(),
          streamSimple: vi.fn(),
        },
      ]),
    );
    const registerNativeProvider = vi.fn();
    const notify = vi.fn();
    const deps = {
      getModels: () => [...natives.values()].flatMap((p) => p.getModels()),
      getProvider: (id: string) => natives.get(id),
      registerNativeProvider,
      notify,
    };
    const runtime = new ApertureRuntime();
    await runtime.sync(deps);
    expect(notify).toHaveBeenCalledOnce();
    expect(registerNativeProvider.mock.calls.at(-1)?.[0]).toBe(
      natives.get("second"),
    );
    await runtime.sync(deps);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  test("missing-model check compares local models against mapped gateway catalog", async () => {
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "anthropic",
          gatewayId: "anthropic-oauth",
          shouldCheckGatewayModels: true,
        },
      ]),
    );
    const notify = vi.fn();
    await new ApertureRuntime().checkMissingModels(
      {
        getModels: () => [
          model("anthropic", "claude"),
          model("anthropic", "missing"),
        ],
        notify,
      },
      [provider("anthropic-oauth", ["claude"])],
    );
    expect(notify.mock.calls[0]?.[0]).toContain("anthropic: missing");
    expect(notify.mock.calls[0]?.[0]).not.toContain("claude,");
  });
});

describe("ApertureRuntime.sync non-chat models", () => {
  test("getAllModels() rewrites chat models but passes non-chat models through untouched", async () => {
    mockCatalog([provider("neuralwatt", ["kimi-k3"])]);
    getConfig.mockReturnValue(
      proxyConfig([{ id: "neuralwatt", shouldCheckGatewayModels: false }]),
    );
    const upstream = "https://api.neuralwatt.com/v1";
    const classifier = {
      provider: "neuralwatt",
      id: "clef-flash",
      type: "classifier",
      api: "typesafe-system-one",
      baseUrl: upstream,
    } as unknown as Model<Api>;
    const { deps, registerNativeProvider } = syncDeps(() => [
      model("neuralwatt", "kimi-k3", "openai-completions", upstream),
      classifier,
    ]);

    await new ApertureRuntime().sync(deps);

    const wrapped = registerNativeProvider.mock.calls
      .map(([p]: unknown[]) => p as { getAllModels?: () => Model<Api>[] })
      .at(-1);
    const served = wrapped?.getAllModels?.() ?? [];
    const decision = served.find((m) => m.id === "clef-flash");
    const chat = served.find((m) => m.id === "kimi-k3");
    expect(decision).toBe(classifier);
    expect(chat?.baseUrl).not.toBe(upstream);
  });
});
