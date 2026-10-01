/**
 * Factory tests for provenance headers and proxy shutdown/reload cleanup.
 * Config, gateway fetches, and settings files are mocked.
 */
import { join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ApertureClient } from "../../src/api/client";
import type { ApertureProvider } from "../../src/api/types";
import type { ResolvedConfig } from "../shared/config/types";
import type { Provider } from "../shared/types";

const mocks = vi.hoisted(() => ({
  config: {
    baseUrl: "https://aperture.test",
    shouldSendProvenanceHeaders: true,
    onboardingDone: true,
    onboarding: { enabled: false },
    proxy: { enabled: false, upstreamProviders: [] },
    dedicated: { enabled: false, providers: [] },
    connectors: { enabled: false },
  } as ResolvedConfig,
  /** Fake settings files, keyed by path; real fs used for everything else. */
  fakeFiles: new Map<string, string>(),
}));

vi.mock("../shared/config/loader", () => ({
  configLoader: {
    load: () => {},
    getConfig: () => mocks.config,
    getRawConfig: () => mocks.config,
  },
}));

vi.mock("../../src/api/client", () => ({ ApertureClient: vi.fn() }));

// Fake settings files without touching disk: hits return from the map,
// everything else (including package reads at import time) delegates.
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const originalReadFileSync = original.readFileSync as (
    path: unknown,
    options?: unknown,
  ) => unknown;
  const mocked = {
    ...original,
    readFileSync: (path: unknown, options?: unknown) => {
      const content = mocks.fakeFiles.get(String(path));
      return content !== undefined
        ? content
        : originalReadFileSync(path, options);
    },
  };
  return { ...mocked, default: mocked };
});

import { resetProvenanceTelemetryCache } from "../shared/provenance";
import factory from "./index";

type HeaderHandler = (
  event: { type: string; headers: Record<string, string> },
  ctx: unknown,
) => unknown;

type LifecycleHandler = (event: { type: string }, ctx: unknown) => unknown;

const SESSION_ID = "test-session-id";

interface SetupOptions {
  piGlobalSettings?: Record<string, unknown>;
}

/** Run the factory, fire the header hook, collect injected headers. */
async function collectInjectedHeaders(
  options: SetupOptions = {},
): Promise<Record<string, string>> {
  if (options.piGlobalSettings) {
    mocks.fakeFiles.set(
      join(getAgentDir(), "settings.json"),
      JSON.stringify(options.piGlobalSettings),
    );
  }

  const handlers = new Map<string, HeaderHandler[]>();
  const pi = new Proxy(
    {
      on: (event: string, handler: HeaderHandler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      events: { on: () => {}, emit: () => {} },
    },
    { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => {}) },
  );
  await factory(pi as unknown as ExtensionAPI);

  const headers: Record<string, string> = {};
  const ctx = { sessionManager: { getSessionId: () => SESSION_ID } };
  for (const handler of handlers.get("before_provider_headers") ?? []) {
    await handler({ type: "before_provider_headers", headers }, ctx);
  }
  return headers;
}

let savedTelemetry: string | undefined;

beforeEach(() => {
  savedTelemetry = process.env.PI_TELEMETRY;
  delete process.env.PI_TELEMETRY;
  mocks.config.shouldSendProvenanceHeaders = true;
  mocks.config.baseUrl = "https://ai.pango-lin.ts.net";
  mocks.config.proxy = { enabled: false, upstreamProviders: [] };
  // Default: an empty global settings file (telemetry gate open), so the
  // real global settings on this machine can't leak into a test.
  mocks.fakeFiles.clear();
  mocks.fakeFiles.set(join(getAgentDir(), "settings.json"), "{}");
  resetProvenanceTelemetryCache();
});

afterEach(() => {
  if (savedTelemetry === undefined) delete process.env.PI_TELEMETRY;
  else process.env.PI_TELEMETRY = savedTelemetry;
});

describe("before_provider_headers gating", () => {
  test("injects Referer + x-session-id by default", async () => {
    const headers = await collectInjectedHeaders();
    expect(headers.Referer).toBe("https://pi.dev");
    expect(headers["x-session-id"]).toBe(SESSION_ID);
  });

  test("shouldSendProvenanceHeaders: false disables injection", async () => {
    mocks.config.shouldSendProvenanceHeaders = false;
    const headers = await collectInjectedHeaders();
    expect(headers.Referer).toBeUndefined();
    expect(headers["x-session-id"]).toBeUndefined();
  });

  test("PI_TELEMETRY=0 skips headers even when the config flag is on", async () => {
    process.env.PI_TELEMETRY = "0";
    const headers = await collectInjectedHeaders();
    expect(headers.Referer).toBeUndefined();
    expect(headers["x-session-id"]).toBeUndefined();
  });

  test("follows pi settings; PI_TELEMETRY env wins over them", async () => {
    const optedOut = await collectInjectedHeaders({
      piGlobalSettings: { enableInstallTelemetry: false },
    });
    expect(optedOut.Referer).toBeUndefined();

    process.env.PI_TELEMETRY = "1";
    resetProvenanceTelemetryCache();
    const envWins = await collectInjectedHeaders({
      piGlobalSettings: { enableInstallTelemetry: false },
    });
    expect(envWins.Referer).toBe("https://pi.dev");
    expect(envWins["x-session-id"]).toBe(SESSION_ID);
  });
});

describe("proxy shutdown cleanup", () => {
  async function setupRegistry(catalog?: Promise<ApertureProvider[]>) {
    const registry = await ModelRuntime.create({
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const native = registry.getProvider("openai") as Provider;
    const sourceModel = native.getModels()[0];
    const providers: ApertureProvider[] = [
      {
        id: "openai",
        name: "OpenAI",
        models: [sourceModel.id],
        requires_client_auth: true,
        compatibility: { openai_responses: true },
      },
    ];
    vi.mocked(ApertureClient).mockImplementation(function (this: object) {
      return Object.assign(this, {
        providers: () => catalog ?? Promise.resolve(providers),
      });
    } as unknown as typeof ApertureClient);
    mocks.config.proxy = {
      enabled: true,
      upstreamProviders: ["openai", "not-installed"].map((id) => ({
        id,
        gatewayId: "openai",
        shouldCheckGatewayModels: false,
        keepGatewayModelsOnly: true,
      })),
    };
    return { registry, native, providers };
  }

  async function loadLifecycle(registry: ModelRuntime) {
    const ctx = {
      modelRegistry: {
        getAll: () => [...registry.getModels()],
        getProvider: (id: string) => registry.getProvider(id),
        refresh: async () => ({ errors: new Map() }),
      },
      ui: { notify: vi.fn() },
    };
    const handlers = new Map<string, LifecycleHandler[]>();
    const registerProvider = vi.fn((provider: Provider) => {
      registry.registerNativeProvider(provider);
    });
    const unregisterProvider = vi.fn((id: string) => {
      registry.unregisterProvider(id);
    });
    const pi = new Proxy(
      {
        on: (event: string, handler: LifecycleHandler) => {
          handlers.set(event, [...(handlers.get(event) ?? []), handler]);
        },
        registerProvider,
        unregisterProvider,
        events: { on: () => {}, emit: () => {} },
      },
      { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => {}) },
    );
    await factory(pi as unknown as ExtensionAPI);
    return {
      registerProvider,
      unregisterProvider,
      emit: async (type: string) => {
        for (const handler of handlers.get(type) ?? []) {
          await handler({ type }, ctx);
        }
        // Drain the fire-and-forget sync and refresh continuations.
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    };
  }

  test("unregisters only providers it registered, once, before teardown", async () => {
    const { registry, native } = await setupRegistry();
    const unrelated = registry.getProvider("anthropic");
    const lifecycle = await loadLifecycle(registry);
    await lifecycle.emit("session_start");
    expect(lifecycle.registerProvider).toHaveBeenCalledTimes(2);
    expect(registry.getProvider("openai")?.auth).toBe(native.auth);
    lifecycle.unregisterProvider.mockClear();

    await lifecycle.emit("session_shutdown");
    expect(lifecycle.unregisterProvider).toHaveBeenCalledExactlyOnceWith(
      "openai",
    );
    expect(registry.getProvider("openai")?.getModels()).toEqual(
      native.getModels(),
    );
    expect(registry.getProvider("anthropic")).toBe(unrelated);
    await lifecycle.emit("session_shutdown");
    expect(lifecycle.unregisterProvider).toHaveBeenCalledTimes(1);
  });

  test.each([
    "stream",
    "streamSimple",
  ] as const)("%s uses the current gateway after shutdown and reload", async (method) => {
    const { registry, native } = await setupRegistry();
    const spy = vi.spyOn(native, method).mockReturnValue({} as never);
    const first = await loadLifecycle(registry);
    await first.emit("session_start");
    await first.emit("session_shutdown");
    mocks.config.baseUrl = "https://aperture.example.ts.net";
    const second = await loadLifecycle(registry);
    await second.emit("session_start");
    const fetch = vi.fn().mockResolvedValue(new Response());
    const reloaded = registry.getProvider("openai") as Provider;
    const model = reloaded.getModels()[0];
    reloaded[method](model, { messages: [] }, { fetch });
    expect(spy).toHaveBeenCalledOnce();
    const [sentModel, , sentOptions] = spy.mock.calls[0];
    expect(sentModel.id).toBe(`openai/${model.id}`);
    await sentOptions?.fetch?.("https://api.openai.com/v1/responses");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      new URL("https://aperture.example.ts.net/v1/responses"),
      undefined,
    );
    await second.emit("session_shutdown");
  });

  test("does not unregister a removed route again on shutdown", async () => {
    const { registry } = await setupRegistry();
    const lifecycle = await loadLifecycle(registry);
    await lifecycle.emit("session_start");
    mocks.config.proxy.upstreamProviders = [];
    await lifecycle.emit("session_start");
    expect(lifecycle.unregisterProvider).toHaveBeenCalledWith("openai");
    lifecycle.unregisterProvider.mockClear();
    await lifecycle.emit("session_shutdown");
    expect(lifecycle.unregisterProvider).not.toHaveBeenCalled();
  });

  test("does not re-register a wrapper when an in-flight catalog settles after shutdown", async () => {
    let release!: (providers: ApertureProvider[]) => void;
    const catalog = new Promise<ApertureProvider[]>((resolve) => {
      release = resolve;
    });
    const { registry, native, providers } = await setupRegistry(catalog);
    const lifecycle = await loadLifecycle(registry);
    await lifecycle.emit("session_start");
    expect(lifecycle.registerProvider).toHaveBeenCalledOnce();
    await lifecycle.emit("session_shutdown");
    lifecycle.registerProvider.mockClear();
    release(providers);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(lifecycle.registerProvider).not.toHaveBeenCalled();
    expect(registry.getProvider("openai")?.getModels()).toEqual(
      native.getModels(),
    );
  });
});
