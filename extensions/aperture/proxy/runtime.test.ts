import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApertureClient } from "../../../src/api/client";
import { shouldUseGatewayRoot } from "../../../src/base-url-routing";
import { configLoader } from "../../../src/shared/config/loader";
import type { ResolvedConfig } from "../../../src/shared/config/types";
import type { Api, Model } from "../../../src/shared/types";
import { ApertureRuntime } from "./runtime";

vi.mock("../../../src/shared/config/loader", () => ({
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

function provider(id: string, models: string[]) {
  return { id, name: id, models, compatibility: {} };
}

function proxyConfig(
  upstreamProviders: { id: string; shouldCheckGatewayModels: boolean }[],
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
    const registerProvider = vi.fn();
    const runtime = new ApertureRuntime();

    await runtime.sync({
      registerProvider,
      getModels: () => [
        model("anthropic", "claude-sonnet-4-6", "anthropic-messages"),
        model(
          "openai",
          "gpt-5.5",
          "openai-responses",
          "https://api.openai.com/v1",
        ),
        model("openai-codex", "gpt-5.5", "openai-codex-responses"),
      ],
    });

    expect(registerProvider).toHaveBeenCalledWith(
      "anthropic",
      expect.objectContaining({ baseUrl: "http://gateway.test" }),
    );
    expect(registerProvider).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({ baseUrl: "http://gateway.test/v1" }),
    );
    expect(registerProvider).toHaveBeenCalledWith(
      "openai-codex",
      expect.objectContaining({ baseUrl: "http://gateway.test" }),
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
    const registerProvider = vi.fn();
    const runtime = new ApertureRuntime();

    await runtime.sync({
      registerProvider,
      getModels: () => [
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
      ],
    });

    expect(registerProvider).toHaveBeenCalledWith(
      "zai",
      expect.objectContaining({ baseUrl: "http://gateway.test" }),
    );
    expect(registerProvider).toHaveBeenCalledWith(
      "openai",
      expect.objectContaining({ baseUrl: "http://gateway.test/v1" }),
    );
    expect(registerProvider).toHaveBeenCalledWith(
      "groq",
      expect.objectContaining({ baseUrl: "http://gateway.test/v1" }),
    );
  });

  test("keeps the inferred upstream base URL stable across re-syncs", async () => {
    const registerProvider = vi.fn();
    const runtime = new ApertureRuntime();

    const upstreamModels = () => [
      model(
        "zai",
        "glm-4.5-air",
        "openai-completions",
        "https://api.z.ai/api/coding/paas/v4",
      ),
    ];

    await runtime.sync({
      registerProvider,
      getModels: upstreamModels,
    });

    // Second sync: model list is already rewritten to the gateway (as Pi
    // would surface after a settings reload). The cached upstream URL must
    // keep Z.ai on gateway root instead of flipping back to /v1.
    const rewrittenModels = () => [
      model("zai", "glm-4.5-air", "openai-completions", "http://gateway.test"),
    ];
    await runtime.sync({
      registerProvider,
      getModels: rewrittenModels,
    });

    const zaiCalls = registerProvider.mock.calls.filter(
      ([name]) => name === "zai",
    );
    expect(zaiCalls).toHaveLength(2);
    for (const [, config] of zaiCalls) {
      expect(config).toEqual(
        expect.objectContaining({ baseUrl: "http://gateway.test" }),
      );
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
    const registerProvider = vi.fn();
    const runtime = new ApertureRuntime();

    await runtime.sync({
      registerProvider,
      getModels: () => [
        model(
          "bedrock",
          "anthropic.claude-3-5-sonnet-20241022-v2:0",
          "bedrock-converse-stream",
          "https://bedrock-runtime.us-east-1.amazonaws.com",
        ),
      ],
    });

    expect(registerProvider).toHaveBeenCalledWith(
      "bedrock",
      expect.objectContaining({ baseUrl: "http://gateway.test/bedrock" }),
    );
  });

  test("aligns a proxied Gemini provider to /v1beta via the shared resolver", async () => {
    // Side effect of sharing getBaseUrlForApi: proxy Gemini now matches
    // dedicated and routes to /v1beta instead of the OpenAI-shaped /v1.
    getConfig.mockReturnValue(
      proxyConfig([{ id: "google", shouldCheckGatewayModels: false }]),
    );
    const registerProvider = vi.fn();
    const runtime = new ApertureRuntime();

    await runtime.sync({
      registerProvider,
      getModels: () => [
        model("google", "gemini-2.5-pro", "google-generative-ai"),
      ],
    });

    expect(registerProvider).toHaveBeenCalledWith(
      "google",
      expect.objectContaining({ baseUrl: "http://gateway.test/v1beta" }),
    );
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
    upstreamProviders: string[],
  ): ResolvedConfig {
    return {
      baseUrl: "http://gateway.test",
      onboardingDone: true,
      onboarding: { enabled: false },
      proxy: {
        enabled,
        upstreamProviders: upstreamProviders.map((id) => ({
          id,
          shouldCheckGatewayModels: false,
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
