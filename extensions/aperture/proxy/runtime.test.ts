import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { configLoader } from "../../../src/shared/config/loader";
import type { Api, Model } from "../../../src/shared/types";
import { ApertureRuntime, shouldUseGatewayRootForProxy } from "./runtime";

vi.mock("../../../src/shared/config/loader", () => ({
  configLoader: {
    getConfig: vi.fn(),
  },
}));

const getConfig = vi.mocked(configLoader.getConfig);

function model(provider: string, id: string, api?: Api): Model<Api> {
  return { provider, id, api } as Model<Api>;
}

function provider(id: string, models: string[]) {
  return { id, name: id, models, compatibility: {} };
}

function proxyConfig(
  upstreamProviders: {
    id: string;
    apertureProviderId?: string;
    shouldCheckGatewayModels: boolean;
  }[],
) {
  return {
    baseUrl: "http://gateway.test",
    onboardingDone: true,
    onboarding: { enabled: false },
    proxy: { enabled: true, upstreamProviders },
    dedicated: { enabled: false, providers: [] },
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
    expect(shouldUseGatewayRootForProxy("openai-responses")).toBe(false);
  });

  test("uses gateway root for Codex because Pi appends /codex/responses", async () => {
    const registerProvider = vi.fn();
    const runtime = new ApertureRuntime();

    await runtime.sync({
      registerProvider,
      getModels: () => [
        model("openai", "gpt-5.5", "openai-responses"),
        model("openai-codex", "gpt-5.5", "openai-codex-responses"),
      ],
      getSessionId: vi.fn(() => "session-id"),
    });

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

  test("checks gateway models under the mapped aperture provider id, not the Pi id", async () => {
    // Manual mapping: Pi provider `claude-local` -> Aperture gateway provider
    // `anthropic`. The gateway model check must look `claude-local` models up
    // under `anthropic` on the gateway, and the warning must make the mapping
    // explicit ("claude-local -> anthropic").
    getConfig.mockReturnValue(
      proxyConfig([
        {
          id: "claude-local",
          apertureProviderId: "anthropic",
          shouldCheckGatewayModels: true,
        },
      ]),
    );
    const notify = vi.fn();
    const runtime = new ApertureRuntime();

    await runtime.checkMissingModels(
      {
        getModels: () => [model("claude-local", "claude-3-5-sonnet")],
        notify,
      },
      [provider("anthropic", ["claude-3-5-haiku"])],
    );

    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0][0]).toContain(
      "claude-local -> anthropic: claude-3-5-sonnet",
    );
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
