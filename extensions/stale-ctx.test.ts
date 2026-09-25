/**
 * Regression for stale `ctx` use after session replacement (#112).
 *
 * Drives the real extension factories through pi's real ExtensionRunner
 * (real stale-guarded ctx getters, real invalidate(), real emit dispatch);
 * only the network layer, config loader, and registry data are stubbed.
 * Deferred continuations from session_start must neither reject unhandled
 * nor surface stale-ctx extension errors when the runner is invalidated
 * while a gateway fetch is in flight.
 */
import {
  createEventBus,
  createExtensionRuntime,
  ExtensionRunner,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ApertureClient } from "../src/api/client";
import { createMcpSession } from "../src/mcp-client";
import apertureFactory from "./aperture/index";
import connectorsFactory from "./connectors/index";
import { configLoader } from "./shared/config/loader";
import type { Api, Model, Provider } from "./shared/types";

vi.mock("./shared/config/loader", () => ({
  configLoader: {
    load: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn(),
    getRawConfig: vi.fn().mockReturnValue({}),
  },
}));
vi.mock("../src/api/client", () => ({ ApertureClient: vi.fn() }));
vi.mock("../src/mcp-client", () => ({ createMcpSession: vi.fn() }));

const BASE_CONFIG = {
  baseUrl: "http://gateway.test",
  onboardingDone: true,
  onboarding: { enabled: false },
  dedicated: { enabled: false, providers: [] },
  connectors: { enabled: false, pinnedTools: [], discoveryTools: true },
};

const unhandledRejections: unknown[] = [];
const onUnhandled = (r: unknown) => unhandledRejections.push(r);
beforeEach(() => {
  unhandledRejections.length = 0;
  process.on("unhandledRejection", onUnhandled);
});
afterEach(() => process.removeListener("unhandledRejection", onUnhandled));

const flush = () => new Promise((r) => setTimeout(r, 50));
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (r?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Runtime = ReturnType<typeof createExtensionRuntime>;

/** pi ExtensionAPI whose stale guard is pi's real runtime.assertActive(). */
function createPiApi(
  runtime: Runtime,
  eventBus: ReturnType<typeof createEventBus>,
  record: { handlers: Map<string, unknown[]>; tools: Map<string, unknown> },
) {
  return {
    on(event: string, handler: unknown) {
      runtime.assertActive();
      record.handlers.set(event, [
        ...(record.handlers.get(event) ?? []),
        handler,
      ]);
    },
    registerTool(tool: { name: string }) {
      runtime.assertActive();
      record.tools.set(tool.name, tool);
    },
    registerCommand() {},
    registerShortcut() {},
    registerFlag() {},
    registerProvider(p: unknown, config?: unknown) {
      runtime.assertActive();
      if (typeof p === "string") runtime.registerProvider(p, config, "<t>");
      else runtime.registerNativeProvider(p, "<t>");
    },
    unregisterProvider(name: string) {
      runtime.assertActive();
      runtime.unregisterProvider(name, "<t>");
    },
    setModel: (m: unknown) => {
      runtime.assertActive();
      return Promise.resolve(m);
    },
    events: {
      emit: (c: string, d: unknown) => {
        runtime.assertActive();
        return eventBus.emit(c, d);
      },
      on: (c: string, h: (d: unknown) => void) => {
        runtime.assertActive();
        return runtime.trackEventBusSubscription(eventBus.on(c, h));
      },
    },
  };
}

async function loadExtension(
  factory: (pi: unknown) => Promise<void>,
  modelRegistry: unknown,
) {
  const runtime = createExtensionRuntime();
  const record = { handlers: new Map(), tools: new Map() };
  await factory(createPiApi(runtime, createEventBus(), record));
  const runner = new ExtensionRunner(
    [{ path: "<t>", ...record }] as never,
    runtime,
    process.cwd(),
    { getSessionId: () => "s1" } as never,
    modelRegistry as never,
  );
  const errors: { event: string; error: string }[] = [];
  runner.onError((e) => errors.push({ event: e.event, error: e.error }));
  return { runner, errors };
}

test("aperture: onSync continuations reject unhandled after session replacement", async () => {
  vi.mocked(configLoader.getConfig).mockReturnValue({
    ...BASE_CONFIG,
    proxy: {
      enabled: true,
      upstreamProviders: [
        { id: "openrouter", enabled: true, shouldCheckGatewayModels: true },
      ],
    },
  } as never);

  // Gateway catalog fetch in flight = the /new, /fork, /resume, reload window.
  const catalog = deferred<unknown[]>();
  vi.mocked(ApertureClient).mockImplementation(function (this: object) {
    return Object.assign(this, { providers: () => catalog.promise });
  } as unknown as typeof ApertureClient);

  const models = [
    {
      provider: "openrouter",
      id: "model-1",
      api: "openai-completions",
    } as Model<Api>,
  ];
  const native = {
    id: "openrouter",
    getModels: () => models,
    auth: {
      apiKey: { name: "k", check: async () => ({}), resolve: async () => ({}) },
    },
    stream: vi.fn(),
    streamSimple: vi.fn(),
  } as unknown as Provider;
  const refresh = deferred<{ errors: Map<string, Error> }>();
  const { runner } = await loadExtension(apertureFactory, {
    getAll: () => models,
    find: () => undefined,
    getProvider: () => native,
    refresh: () => refresh.promise,
  });

  await runner.emit({ type: "session_start" } as never);
  await flush();
  expect(unhandledRejections).toEqual([]); // sane before replacement

  runner.invalidate(); // what teardownCurrent does via beforeSessionInvalidate

  catalog.resolve([
    {
      id: "openrouter",
      name: "OpenRouter",
      models: ["model-1"],
      compatibility: { openai_completions: true },
      requires_client_auth: false,
      modelInfoById: {},
    },
  ]);
  refresh.resolve({ errors: new Map([["aperture", new Error("boom")]]) });
  await flush();

  // Regression: 3 unhandled rejections, each
  // "This extension ctx is stale after session replacement or reload..."
  expect(unhandledRejections).toEqual([]);
});

test("connectors: stale ctx touched in async session_start handler", async () => {
  vi.mocked(configLoader.getConfig).mockReturnValue({
    ...BASE_CONFIG,
    proxy: { enabled: false, upstreamProviders: [] },
    connectors: { enabled: true, pinnedTools: [], discoveryTools: true },
  } as never);
  const mcp = deferred<never>();
  vi.mocked(createMcpSession).mockReturnValue(mcp.promise);
  const { runner, errors } = await loadExtension(connectorsFactory, {
    getAll: () => [],
    find: () => undefined,
    getProvider: () => undefined,
    refresh: () => Promise.resolve({ errors: new Map() }),
  });

  const emitPromise = runner.emit({ type: "session_start" } as never);
  await flush(); // handler parked on `await createMcpSession(baseUrl)`

  runner.invalidate();
  mcp.reject(new Error("connect failed")); // catch block calls ctx.ui.notify
  await emitPromise;
  await flush();

  // Regression: one extension error
  // "session_start: This extension ctx is stale after session replacement..."
  // (contained by runner.emit's try/catch — no unhandled rejection here).
  expect(errors).toEqual([]);
  expect(unhandledRejections).toEqual([]);
});
