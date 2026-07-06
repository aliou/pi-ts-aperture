import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { configLoader } from "../../../src/shared/config/loader";
import type { ResolvedConfig } from "../../../src/shared/config/types";
import type { Api, Model } from "../../../src/shared/types";
import { ApertureRuntime, shouldUseGatewayRootForProxy } from "./runtime";

vi.mock("../../../src/shared/config/loader", () => ({
  configLoader: {
    getConfig: vi.fn(),
  },
}));

const getConfig = vi.mocked(configLoader.getConfig);

afterEach(() => {
  vi.unstubAllGlobals();
});

function model(provider: string, id: string, api?: Api): Model<Api> {
  return { provider, id, api } as Model<Api>;
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
      "@earendil-works/pi-ai/openai-codex-responses",
    );
    const source = readFileSync(new URL(codexProviderUrl), "utf8");

    expect(source).toMatch(
      /function resolveCodexUrl[\s\S]*if \(normalized\.endsWith\("\/codex\/responses"\)\)[\s\S]*return normalized;[\s\S]*if \(normalized\.endsWith\("\/codex"\)\)[\s\S]*return `\$\{normalized\}\/responses`;[\s\S]*return `\$\{normalized\}\/codex\/responses`;/,
    );
    expect(shouldUseGatewayRootForProxy("openai-codex-responses")).toBe(true);
    expect(shouldUseGatewayRootForProxy("anthropic-messages")).toBe(true);
    expect(shouldUseGatewayRootForProxy("openai-responses")).toBe(false);
  });

  test("uses gateway root for Anthropic and Codex because Pi appends API paths", async () => {
    const registerProvider = vi.fn();
    const runtime = new ApertureRuntime();

    await runtime.sync({
      registerProvider,
      getModels: () => [
        model("anthropic", "claude-sonnet-4-6", "anthropic-messages"),
        model("openai", "gpt-5.5", "openai-responses"),
        model("openai-codex", "gpt-5.5", "openai-codex-responses"),
      ],
      getSessionId: vi.fn(() => "session-id"),
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

  test("warns and skips when gateway provider fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    const notify = vi.fn();
    const runtime = new ApertureRuntime();

    await expect(
      runtime.checkMissingModels({
        getModels: () => [model("synthetic", "foo")],
        notify,
      }),
    ).resolves.toBeUndefined();

    expect(notify).toHaveBeenCalledWith(
      "[aperture] gateway model check skipped: fetch failed",
      "warning",
    );
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
