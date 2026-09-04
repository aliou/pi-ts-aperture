import { expect, test, vi } from "vitest";
import { ApertureClient } from "../../src/api/client";
import { configLoader } from "../shared/config/loader";
import type { Api, Model, Provider } from "../shared/types";
import { ApertureRuntime } from "./proxy/runtime";

vi.mock("../shared/config/loader", () => ({
  configLoader: { getConfig: vi.fn() },
}));

vi.mock("../../src/api/client", () => ({
  ApertureClient: vi.fn(),
}));

test("registers placeholder auth before the gateway catalog fetch resolves", async () => {
  vi.mocked(configLoader.getConfig).mockReturnValue({
    baseUrl: "http://gateway.test",
    onboardingDone: true,
    onboarding: { enabled: false },
    proxy: {
      enabled: true,
      upstreamProviders: [
        { id: "openrouter", shouldCheckGatewayModels: false },
      ],
    },
    dedicated: { enabled: false, providers: [] },
    connectors: { enabled: false, pinnedTools: [], discoveryTools: true },
  });

  let resolveCatalog!: (value: never[]) => void;
  const catalog = new Promise<never[]>((resolve) => {
    resolveCatalog = resolve;
  });
  vi.mocked(ApertureClient).mockImplementation(function (this: {
    providers: () => Promise<never[]>;
  }) {
    this.providers = () => catalog;
    return this;
  } as unknown as typeof ApertureClient);

  const nativeResolve = vi.fn().mockResolvedValue({
    auth: { apiKey: "real-key" },
    source: "env",
  });
  const models = [
    {
      provider: "openrouter",
      id: "model-1",
      api: "openai-completions",
      baseUrl: "https://openrouter.ai/api/v1",
    } as Model<Api>,
  ];
  const native = {
    id: "openrouter",
    getModels: () => models,
    auth: { apiKey: { name: "OpenRouter key", resolve: nativeResolve } },
    stream: vi.fn(),
    streamSimple: vi.fn(),
  } as unknown as Provider;
  const registerNativeProvider = vi.fn();

  const sync = new ApertureRuntime().sync({
    getProvider: () => native,
    registerNativeProvider,
    getModels: () => models,
  });
  await Promise.resolve();

  expect(registerNativeProvider).toHaveBeenCalled();
  const wrapped = registerNativeProvider.mock.calls[0]?.[0] as Provider;
  await expect(wrapped.auth?.apiKey?.resolve?.({} as never)).resolves.toEqual({
    auth: { apiKey: "-" },
    source: "aperture proxy",
  });
  expect(nativeResolve).not.toHaveBeenCalled();

  resolveCatalog([]);
  await sync;
});
