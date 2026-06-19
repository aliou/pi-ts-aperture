import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { configLoader } from "../../src/shared/config/loader";
import { emitConfigSync } from "../../src/shared/sync-bus";
import { DedicatedRuntime } from "./dedicated/runtime";
import { registerOnboarding } from "./onboarding";
import { ApertureRuntime } from "./proxy/runtime";
import { registerApertureSettings } from "./settings-command";

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const proxyRuntime = new ApertureRuntime();
  const dedicatedRuntime = new DedicatedRuntime();

  // Stale-while-revalidate seed for dedicated Aperture models.
  //
  // Dedicated models are only discoverable by hitting the Aperture
  // `/api/providers` endpoint, which we can do inside `session_start`. Pi
  // validates scoped models during startup, *before* `session_start` fires,
  // so we synchronously restore the previous session's fetch from the on-disk
  // cache so the provider is registered with cached models at load time.
  // `session_start` then revalidates from the live gateway, writes the cache
  // back, and re-registers with fresh models. First run with no cache still
  // warns once until the first revalidation persists a cache.
  dedicatedRuntime.registerCached(pi);
  let lastProxyProviders = configLoader
    .getConfig()
    .proxy.upstreamProviders.map((p) => p.id);
  let knownModels = [] as ReturnType<
    ExtensionContext["modelRegistry"]["getAll"]
  >;

  const updateKnownModels = (ctx: ExtensionContext): void => {
    knownModels = ctx.modelRegistry.getAll();
  };

  const onSync = (ctx: ExtensionContext): void => {
    updateKnownModels(ctx);
    emitConfigSync();
    const config = configLoader.getConfig();

    const nextProxyProviders = config.proxy.enabled
      ? config.proxy.upstreamProviders.map((p) => p.id)
      : [];
    for (const provider of proxyRuntime.getProvidersToUnregister(
      lastProxyProviders,
      nextProxyProviders,
    )) {
      pi.unregisterProvider(provider);
      ctx.ui.notify(`[aperture] unregistered ${provider}.`, "info");
    }
    lastProxyProviders = nextProxyProviders;

    void proxyRuntime
      .sync({
        registerProvider: pi.registerProvider.bind(pi),
        getModels: () => ctx.modelRegistry.getAll(),
        getSessionId: () => ctx.sessionManager.getSessionId(),
      })
      .then(() => {
        const active = ctx.model;
        if (!active) return;
        const updated = ctx.modelRegistry.find(active.provider, active.id);
        if (updated && nextProxyProviders.includes(active.provider)) {
          void pi.setModel(updated);
        }
      });

    void proxyRuntime.checkMissingModels({
      getModels: () => ctx.modelRegistry.getAll(),
      notify: (msg, type) => ctx.ui.notify(msg, type),
    });

    void dedicatedRuntime.sync(pi).catch((error: unknown) => {
      ctx.ui.notify(
        `[aperture] dedicated sync failed: ${error instanceof Error ? error.message : String(error)}`,
        "warning",
      );
    });
  };

  pi.on("session_start", (_event, ctx) => {
    onSync(ctx);
  });

  registerApertureSettings(pi, onSync, () => knownModels);
  registerOnboarding(pi);
}
