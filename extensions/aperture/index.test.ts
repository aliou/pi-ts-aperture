import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, type Mock, test, vi } from "vitest";
import type { Api, Model } from "../shared/types";

// The entry point is where every host divergence is decided, so these tests
// drive the real factory against fake hosts: one with native providers and a
// whole-registry `refresh()`, one with neither and a per-provider
// `refreshProvider()`. Everything the factory pulls in is mocked so the test
// exercises `onSync` and nothing else.
const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  load: vi.fn(async () => {}),
  sync: vi.fn(async () => {}),
  checkMissingModels: vi.fn(async () => {}),
  resolveProxyProviderSync: vi.fn(() => ({ next: [], unregister: [] })),
  registerDedicatedProvider: vi.fn(),
  reconcileDedicatedProvider: vi.fn(),
}));

vi.mock("../shared/config/loader", () => ({
  configLoader: { load: mocks.load, getConfig: mocks.getConfig },
}));

vi.mock("./proxy/runtime", () => ({
  ApertureRuntime: class {
    sync = mocks.sync;
    checkMissingModels = mocks.checkMissingModels;
    resolveProxyProviderSync = mocks.resolveProxyProviderSync;
  },
}));

vi.mock("./dedicated/runtime", () => ({
  registerDedicatedProvider: mocks.registerDedicatedProvider,
  reconcileDedicatedProvider: mocks.reconcileDedicatedProvider,
}));

vi.mock("./onboarding", () => ({ registerOnboarding: vi.fn() }));
vi.mock("./settings", () => ({ registerApertureSettings: vi.fn() }));

// Dynamic import so the mocks above are installed before the factory's own
// imports resolve; the sibling runtime suites load their subject the same way.
const indexModule = await import("./index");
const factory = indexModule.default;

type Handler = (event: unknown, ctx: unknown) => void;

interface FakeHost {
  handlers: Map<string, Handler>;
  setModel: Mock;
  notify: Mock;
  ctx: unknown;
  invalidate: () => void;
}

function model(provider: string, id: string): Model<Api> {
  return { provider, id } as Model<Api>;
}

/**
 * Let the fire-and-forget promise chains in `onSync` settle. Microtasks drain
 * the chains; the `setImmediate` turn is required because Node only emits
 * `unhandledRejection` once the microtask queue is empty. Both are ticks, not
 * wall-clock delays, so this stays deterministic.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  await promise;
}
/**
 * A host whose `ctx` getters throw once invalidated, exactly as pi's
 * `ExtensionRunner` does after a session replacement or reload.
 */
function fakeHost(options: {
  native?: boolean;
  refreshResult?: unknown;
  refreshRejects?: unknown;
  activeModel?: Model<Api>;
  found?: Model<Api>;
  findThrows?: unknown;
  setModelRejects?: unknown;
}): FakeHost {
  const handlers = new Map<string, Handler>();
  const notify = vi.fn();
  const setModel = vi.fn(() =>
    options.setModelRejects
      ? Promise.reject(options.setModelRejects)
      : Promise.resolve(),
  );
  let alive = true;
  const assertActive = (): void => {
    if (!alive) throw new Error("This extension ctx is stale");
  };
  const resolveRefresh = async (): Promise<unknown> => {
    if (options.refreshRejects) throw options.refreshRejects;
    return options.refreshResult;
  };

  const registry = {
    getAll: () => [],
    find: () => {
      if (options.findThrows) throw options.findThrows;
      return options.found;
    },
    refresh: resolveRefresh,
    ...(options.native
      ? { getProvider: () => undefined }
      : { refreshProvider: resolveRefresh }),
  };

  const ctx = {
    get ui() {
      assertActive();
      return { notify };
    },
    get model() {
      assertActive();
      return options.activeModel;
    },
    get modelRegistry() {
      assertActive();
      return registry;
    },
    get sessionManager() {
      assertActive();
      return { getSessionId: () => "session-1" };
    },
  };

  return {
    handlers,
    setModel,
    notify,
    ctx,
    invalidate: () => {
      alive = false;
    },
  };
}

async function start(host: FakeHost): Promise<void> {
  const pi = {
    on: (name: string, handler: Handler) => host.handlers.set(name, handler),
    events: { on: vi.fn(), emit: vi.fn() },
    setModel: host.setModel,
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
  };
  // The fake implements only the surface the factory touches.
  await factory(pi as unknown as ExtensionAPI);
}

function syncDepsFor(host: FakeHost): Record<string, unknown> {
  host.handlers.get("session_start")?.({}, host.ctx);
  return (mocks.sync.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  mocks.getConfig.mockReturnValue({
    baseUrl: "http://gateway.test",
    proxy: { enabled: false, upstreamProviders: [] },
    dedicated: { enabled: true, providers: [] },
  });
  mocks.sync.mockClear();
  mocks.resolveProxyProviderSync.mockReturnValue({
    next: ["openai"],
    unregister: [],
  });
});

describe("host capability selection", () => {
  test("passes native deps only when the registry has getProvider", async () => {
    const nativeHost = fakeHost({ native: true });
    await start(nativeHost);
    expect(syncDepsFor(nativeHost)).toHaveProperty("native");

    mocks.sync.mockClear();
    const configHost = fakeHost({ native: false });
    await start(configHost);
    expect(syncDepsFor(configHost)).not.toHaveProperty("native");
  });

  test("always supplies the config registration and unregister hooks", async () => {
    const host = fakeHost({ native: false });
    await start(host);

    const deps = syncDepsFor(host);
    expect(deps.registerProviderConfig).toBeTypeOf("function");
    expect(deps.unregisterProvider).toBeTypeOf("function");
    expect(deps.headers).toEqual({
      Referer: "https://pi.dev",
      "x-session-id": "session-1",
    });
  });

  // Hosts that bake registration headers only refresh them when onSync runs,
  // so every transition that changes the session id has to reach it.
  test("subscribes to the session transitions a fork emits separately", async () => {
    const host = fakeHost({ native: false });
    await start(host);

    for (const name of ["session_start", "session_switch", "session_branch"]) {
      expect(host.handlers.get(name)).toBeTypeOf("function");
    }
  });
});

describe("refresh error relay", () => {
  test("relays a Map of Errors, as pi resolves", async () => {
    const host = fakeHost({
      native: true,
      refreshResult: { errors: new Map([["aperture", new Error("boom")]]) },
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("model refresh failed: boom"),
      "warning",
    );
  });

  // The other host's shape is unpinned, so a record of non-Errors must not
  // degrade to "[object Object]" or vanish.
  test("relays a plain record whose entry is not an Error", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: { errors: { aperture: { message: "gateway 503" } } },
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("gateway 503"),
      "warning",
    );
  });

  test("relays a Map whose value is a bare string", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: { errors: new Map([["aperture", "gateway 500"]]) },
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("gateway 500"),
      "warning",
    );
  });

  // Untested until round 3: an array element that nests the real failure
  // serialises to `{}`, because Error properties are not enumerable.
  test("unwraps a nested Error in an array-shaped errors list", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: {
        errors: [
          { provider: "other", error: new Error("not this one") },
          { provider: "aperture", error: new Error("gateway 502") },
        ],
      },
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("gateway 502"),
      "warning",
    );
  });

  // `toError` must be total: a throw here would suppress the relay it sits in
  // and skip the re-pick that follows it.
  test("survives an error value JSON.stringify cannot serialise", async () => {
    const cyclic: Record<string, unknown> = { code: 17n };
    cyclic.self = cyclic;
    const host = fakeHost({
      native: false,
      refreshResult: { errors: { aperture: cyclic } },
      activeModel: model("aperture", "openai/gpt-5"),
      found: model("aperture", "openai/gpt-5"),
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("model refresh failed"),
      "warning",
    );
    // The re-pick still ran, which is the point of the relay being total.
    expect(host.setModel).toHaveBeenCalled();
  });

  // Two session transitions can overlap: `onSync` returns immediately while
  // its refresh continues. An older sync finishing last must not re-select a
  // model or relay an error for a session that has moved on.
  test("an overtaken sync does not act on what it finds", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: { errors: new Map([["aperture", new Error("stale")]]) },
      activeModel: model("aperture", "openai/gpt-5"),
      found: model("aperture", "openai/gpt-5"),
    });
    await start(host);

    // Two transitions back to back, before either refresh settles.
    host.handlers.get("session_start")?.({}, host.ctx);
    host.handlers.get("session_switch")?.({}, host.ctx);

    await settle();
    // Only the newer sync acted: one relay, one re-pick, not two.
    expect(
      host.notify.mock.calls.filter(([msg]) =>
        String(msg).includes("model refresh failed"),
      ),
    ).toHaveLength(1);
    expect(host.setModel).toHaveBeenCalledTimes(1);
  });

  test("stays quiet when the host resolves nothing", async () => {
    const host = fakeHost({ native: false, refreshResult: undefined });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("model refresh failed"),
      "warning",
    );
  });
});

// Regression: a refresh or sync that settles after `/new`, `/fork` or a
// reload touches a ctx whose every getter throws. Reporting that through the
// same ctx turns one dead-context throw into an unhandled rejection.
describe("settling after session replacement", () => {
  async function withoutUnhandledRejections(
    body: () => Promise<void>,
  ): Promise<unknown[]> {
    const rejections: unknown[] = [];
    const onRejection = (error: unknown): void => {
      rejections.push(error);
    };
    process.on("unhandledRejection", onRejection);
    try {
      await body();
    } finally {
      process.off("unhandledRejection", onRejection);
    }
    return rejections;
  }

  test("a rejected refresh does not produce an unhandled rejection", async () => {
    const host = fakeHost({
      native: false,
      refreshRejects: new Error("gateway down"),
    });

    const rejections = await withoutUnhandledRejections(async () => {
      await start(host);
      host.handlers.get("session_start")?.({}, host.ctx);
      host.invalidate();
      await settle();
    });

    expect(rejections).toEqual([]);
  });

  test("a resolved refresh abandons the re-pick instead of throwing", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: { errors: new Map() },
      activeModel: model("aperture", "openai/gpt-5"),
      found: model("aperture", "openai/gpt-5"),
    });

    const rejections = await withoutUnhandledRejections(async () => {
      await start(host);
      host.handlers.get("session_start")?.({}, host.ctx);
      host.invalidate();
      await settle();
    });

    expect(rejections).toEqual([]);
    expect(host.setModel).not.toHaveBeenCalled();
  });
});

// Regression: this is the only notify closure the host retains and invokes on
// its own schedule (inside `refreshModels` / `fetchDynamicModels`), so it
// outlives the session by longer than any other. A raw `ctx.ui.notify` here
// turns a cosmetic api-override warning into a rejected catalog fetch, which
// empties the model picker rather than losing one message.
describe("the notify closure handed to the dedicated provider", () => {
  test("does not throw once the session is gone", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: { errors: new Map() },
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    const notifyArg = mocks.reconcileDedicatedProvider.mock.calls.at(-1)?.[2] as
      | ((msg: string) => void)
      | undefined;
    expect(notifyArg).toBeTypeOf("function");

    host.invalidate();
    expect(() => notifyArg?.("api override not served")).not.toThrow();
  });
});

describe("proxy model re-pick", () => {
  test("reports a rejected re-pick rather than leaking the rejection", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: { errors: new Map() },
      activeModel: model("openai", "gpt-5"),
      found: model("openai", "gpt-5"),
      setModelRejects: new Error("No API key for openai/gpt-5"),
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("could not re-select openai/gpt-5"),
      "warning",
    );
  });
});

describe("dedicated model re-pick", () => {
  test("re-picks the active dedicated model after a refresh", async () => {
    const updated = model("aperture", "openai/gpt-5");
    const host = fakeHost({
      native: false,
      refreshResult: { errors: new Map() },
      activeModel: model("aperture", "openai/gpt-5"),
      found: updated,
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.setModel).toHaveBeenCalledWith(updated);
  });

  // Regression (round 2): the whole re-pick used to sit in one try/catch whose
  // `return` ran before the relay, so a re-pick failure suppressed the
  // gateway's own error report. The relay now runs first and `registry.find`
  // is outside the guard, so its failure reaches the terminal handler.
  test("relays the gateway error even when the re-pick throws", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: {
        errors: new Map([["aperture", new Error("gateway 503")]]),
      },
      activeModel: model("aperture", "openai/gpt-5"),
      findThrows: new Error("registry exploded"),
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("gateway 503"),
      "warning",
    );
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("registry exploded"),
      "warning",
    );
  });

  test("leaves a non-dedicated active model alone", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: { errors: new Map() },
      activeModel: model("anthropic", "claude-x"),
      found: model("anthropic", "claude-x"),
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.setModel).not.toHaveBeenCalled();
  });

  test("reports a rejected re-pick rather than discarding it", async () => {
    const host = fakeHost({
      native: false,
      refreshResult: { errors: new Map() },
      activeModel: model("aperture", "openai/gpt-5"),
      found: model("aperture", "openai/gpt-5"),
      setModelRejects: new Error("No API key for aperture/openai/gpt-5"),
    });
    await start(host);
    host.handlers.get("session_start")?.({}, host.ctx);

    await settle();
    expect(host.notify).toHaveBeenCalledWith(
      expect.stringContaining("could not re-select"),
      "warning",
    );
  });
});
