import type { ModelsRefreshResult, Provider } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { markRetryableApertureError } from "../../src/retryable-errors";
import { configLoader } from "../shared/config/loader";
import {
  APERTURE_FEATURE_REGISTER_EVENT,
  APERTURE_FEATURE_REQUEST_EVENT,
  createFeatureRequestPayload,
} from "../shared/events";
import { emitConfigSync } from "../shared/sync-bus";
import { DEDICATED_PROVIDER_ID } from "./dedicated/provider";
import {
  reconcileDedicatedProvider,
  registerDedicatedProvider,
} from "./dedicated/runtime";
import { registerOnboarding } from "./onboarding";
import { ApertureRuntime } from "./proxy/runtime";
import { registerApertureSettings } from "./settings";

/**
 * Registry surface across hosts. pi forces a refresh with an options object;
 * hosts that cache dynamic catalogs per provider expose `refreshProvider`
 * instead, and have no `getProvider` because they have no native providers.
 */
type HostModelRegistry = ExtensionContext["modelRegistry"] & {
  refreshProvider?: (
    provider: string,
    mode?: "online" | "offline" | "online-if-uncached",
  ) => Promise<unknown>;
};

/**
 * Provenance headers. pi also sets these per request from
 * `before_provider_headers`; hosts without that event get them baked into the
 * provider registrations that `onSync` refreshes on every session start.
 */
function provenanceHeaders(ctx: ExtensionContext): Record<string, string> {
  return {
    Referer: "https://pi.dev",
    "x-session-id": ctx.sessionManager.getSessionId(),
  };
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const proxyRuntime = new ApertureRuntime();

  // Registry model snapshot for dedicated refreshes, refreshed on every
  // `onSync` (see `updateKnownModels`). Deliberately plain data: capturing
  // `ctx` or `ctx.modelRegistry` is forbidden after session replacement or
  // reload (pi invalidates the runner and every ctx accessor throws), while
  // a snapshot can only go slightly stale, which is harmless for metadata
  // and base URL inference.
  let knownModels = [] as ReturnType<
    ExtensionContext["modelRegistry"]["getAll"]
  >;
  const getRegistryModels = () => knownModels;

  // Inject a provenance header and the live session id on every provider
  // request. `x-session-id` must reflect the current session (it changes on
  // /fork, /new, /resume), so it cannot be baked into provider registration.
  // The hook fires per request, after Pi assembles the outgoing headers.
  //
  // Hosts without a `before_provider_headers` event store the handler and
  // never fire it; there the same headers come from `provenanceHeaders`,
  // baked into the registrations `onSync` refreshes each session start.
  pi.on("before_provider_headers", (event, ctx) => {
    event.headers.Referer = "https://pi.dev";
    event.headers["x-session-id"] = ctx.sessionManager.getSessionId();
  });

  // Tag transient gateway failures so Pi's auto-retry picks them up. Pi
  // applies `message_end` replacements in place before the retry check runs.
  // Hooking the message rather than the provider also covers proxy mode.
  pi.on("message_end", (event) => {
    if (event.message.role !== "assistant") return;
    const message = event.message;
    if (message.stopReason !== "error" || !message.errorMessage) return;

    const errorMessage = markRetryableApertureError(message.errorMessage);
    if (!errorMessage) return;

    return { message: { ...message, errorMessage } };
  });

  // Register the dedicated provider with a `refreshModels` hook. Pi restores
  // the previous catalog from its models store (`models-store.json`)
  // synchronously after registration, so scoped models validate during
  // startup even offline. `session_start` triggers the networked
  // revalidation via `ctx.modelRegistry.refresh()`. First run with no stored
  // catalog still resolves nothing until that first refresh lands.
  registerDedicatedProvider(pi, getRegistryModels);
  let lastProxyProviders = configLoader
    .getConfig()
    .proxy.upstreamProviders.filter((p) => p.enabled !== false)
    .map((p) => p.id);

  const loadedFeatures = new Set<string>();

  pi.events.on(APERTURE_FEATURE_REGISTER_EVENT, (data: unknown) => {
    const payload = data as { feature?: { id: string } };
    if (payload.feature?.id) loadedFeatures.add(payload.feature.id);
  });

  const updateKnownModels = (ctx: ExtensionContext): void => {
    knownModels = ctx.modelRegistry.getAll();
  };

  const onSync = (ctx: ExtensionContext): void => {
    updateKnownModels(ctx);
    emitConfigSync();
    const config = configLoader.getConfig();
    const registry = ctx.modelRegistry as HostModelRegistry;
    const headers = provenanceHeaders(ctx);

    const { next: nextProxyProviders, unregister } =
      proxyRuntime.resolveProxyProviderSync(config, lastProxyProviders);
    for (const provider of unregister) {
      pi.unregisterProvider(provider);
      ctx.ui.notify(`[aperture] unregistered ${provider}.`, "info");
    }
    lastProxyProviders = nextProxyProviders;

    const hasNativeProviders = typeof registry.getProvider === "function";
    void proxyRuntime
      .sync({
        ...(hasNativeProviders
          ? {
              getProvider: (id: string) => registry.getProvider(id),
              registerNativeProvider: (provider: Provider) =>
                pi.registerProvider(provider),
            }
          : {}),
        registerProviderConfig: (name, providerConfig) =>
          pi.registerProvider(name, providerConfig),
        getModels: () => registry.getAll(),
        headers,
        notify: (msg, type) => ctx.ui.notify(msg, type),
      })
      .then(() => {
        const active = ctx.model;
        if (!active) return;
        const updated = registry.find(active.provider, active.id);
        if (updated && nextProxyProviders.includes(active.provider)) {
          void pi.setModel(updated);
        }
      });

    void proxyRuntime.checkMissingModels({
      getModels: () => registry.getAll(),
      notify: (msg, type) => ctx.ui.notify(msg, type),
    });

    reconcileDedicatedProvider(
      pi,
      getRegistryModels,
      (msg) => ctx.ui.notify(msg, "warning"),
      headers,
    );

    // Trigger the networked model refresh: Pi's own startup refresh runs
    // before extensions load, so the dedicated provider never sees it.
    // Built-in providers self-throttle, so this costs about one gateway
    // fetch. Refresh failures fall back to the stored catalog inside Pi.
    // Hosts that cache dynamic catalogs per provider need the forcing
    // per-provider call, or the refresh is served from that cache.
    const refresh = registry.refreshProvider
      ? registry.refreshProvider(DEDICATED_PROVIDER_ID, "online")
      : registry.refresh();
    void Promise.resolve(refresh)
      .then((result) => {
        // Per-provider refresh errors resolve rather than reject; relay them.
        const error = (result as ModelsRefreshResult | undefined)?.errors?.get(
          DEDICATED_PROVIDER_ID,
        );
        if (error) {
          ctx.ui.notify(
            `[aperture] model refresh failed: ${error.message}`,
            "warning",
          );
        }

        // Hosts without `before_provider_headers` bake the registration's
        // headers into each model config, so the session headers only reach
        // models this refresh rebuilt. Re-pick the active dedicated model so
        // the current session's `x-session-id` is the one that ships.
        const active = ctx.model;
        if (active?.provider !== DEDICATED_PROVIDER_ID) return;
        const updated = registry.find(active.provider, active.id);
        if (updated) void pi.setModel(updated);
      })
      .catch((error: unknown) => {
        ctx.ui.notify(
          `[aperture] model refresh failed: ${error instanceof Error ? error.message : String(error)}`,
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
  });

  registerApertureSettings(pi, onSync, () => knownModels);
  registerOnboarding(pi);
}
