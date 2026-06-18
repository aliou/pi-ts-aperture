import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DedicatedRuntime } from "./dedicated/runtime";
import { registerOnboarding } from "./onboarding";
import { ApertureRuntime } from "./proxy/runtime";
import { registerApertureSettings } from "./settings-command";
import { configLoader } from "./shared/config/loader";
import { emitConfigSync } from "./shared/sync-bus";

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const proxyRuntime = new ApertureRuntime();
  const dedicatedRuntime = new DedicatedRuntime();
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
