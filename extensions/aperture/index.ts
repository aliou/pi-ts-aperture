import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { configLoader } from "../../src/shared/config/loader";
import {
  APERTURE_FEATURE_REGISTER_EVENT,
  APERTURE_FEATURE_REQUEST_EVENT,
  APERTURE_PROXY_MODEL_SELECTED_EVENT,
  createFeatureRequestPayload,
  createProxyModelSelectedPayload,
} from "../../src/shared/events";
import { emitConfigSync } from "../../src/shared/sync-bus";
import { resolveProviderBaseUrl } from "../../src/url";
import { DedicatedRuntime } from "./dedicated/runtime";
import { registerOnboarding } from "./onboarding";
import { ApertureRuntime } from "./proxy/runtime";
import { registerApertureSettings } from "./settings";

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const proxyRuntime = new ApertureRuntime();
  const dedicatedRuntime = new DedicatedRuntime();

  // Inject provenance headers and the live session id on every provider
  // request. `x-session-id` must reflect the current session (it changes on
  // /fork, /new, /resume), so it cannot be baked into provider registration.
  // The hook fires per request, after Pi assembles the outgoing headers.
  pi.on("before_provider_headers", (event, ctx) => {
    event.headers.Referer = "https://pi.dev";
    event.headers["X-Title"] = "npm:@aliou/pi-ts-aperture";
    event.headers["x-session-id"] = ctx.sessionManager.getSessionId();
  });

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

  const loadedFeatures = new Set<string>();

  pi.events.on(APERTURE_FEATURE_REGISTER_EVENT, (data: unknown) => {
    const payload = data as { feature?: { id: string } };
    if (payload.feature?.id) loadedFeatures.add(payload.feature.id);
  });

  const updateKnownModels = (ctx: ExtensionContext): void => {
    knownModels = ctx.modelRegistry.getAll();
  };

  const emitProxyModelSelected = (
    model: { provider: string; id: string },
    selectionSource: "set" | "cycle" | "restore" | "session_start",
  ): void => {
    const config = configLoader.getConfig();
    const isProxied =
      model.provider !== "aperture" &&
      config.proxy.enabled &&
      resolveProviderBaseUrl(config) !== null &&
      config.proxy.upstreamProviders.some(
        (provider) => provider.id === model.provider,
      );
    if (!isProxied) return;

    pi.events.emit(
      APERTURE_PROXY_MODEL_SELECTED_EVENT,
      createProxyModelSelectedPayload(model, selectionSource),
    );
  };

  const onSync = (ctx: ExtensionContext): void => {
    updateKnownModels(ctx);
    emitConfigSync();
    const config = configLoader.getConfig();

    const { next: nextProxyProviders, unregister } =
      proxyRuntime.resolveProxyProviderSync(config, lastProxyProviders);
    for (const provider of unregister) {
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
    loadedFeatures.clear();
    pi.events.emit(
      APERTURE_FEATURE_REQUEST_EVENT,
      createFeatureRequestPayload(),
    );
    onSync(ctx);
    if (ctx.model) emitProxyModelSelected(ctx.model, "session_start");
  });

  pi.on("model_select", (event) => {
    emitProxyModelSelected(event.model, event.source);
  });

  registerApertureSettings(pi, onSync, () => knownModels);
  registerOnboarding(pi);
}
