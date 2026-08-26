import type { Provider } from "@earendil-works/pi-ai";
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
 * Registry surface across hosts. pi refreshes every provider through one
 * `refresh()`; hosts that cache dynamic catalogs per provider expose
 * `refreshProvider(id, mode)`, the only call that bypasses that cache, and
 * have no `getProvider` because they have no native providers. `getProvider`
 * is re-declared optional so the capability check below is a real narrowing
 * rather than an always-true test.
 */
type HostModelRegistry = Omit<
  ExtensionContext["modelRegistry"],
  "getProvider"
> & {
  getProvider?: ExtensionContext["modelRegistry"]["getProvider"];
  refreshProvider?: (
    provider: string,
    mode?: "online" | "offline" | "online-if-uncached",
  ) => Promise<unknown>;
};

/**
 * Pull this provider's refresh error out of whatever the host's refresh
 * resolved to. pi resolves a `ModelsRefreshResult` whose `errors` is a `Map`;
 * `refreshProvider` is another host's API with an unpinned shape, so accept a
 * plain record too and stay quiet on anything else rather than throwing a
 * client bug into the gateway's error channel.
 */
function refreshErrorFor(result: unknown, id: string): Error | undefined {
  const errors = (result as { errors?: unknown } | undefined)?.errors;
  if (errors instanceof Map) return errors.get(id) as Error | undefined;
  if (errors && typeof errors === "object") {
    const entry = (errors as Record<string, unknown>)[id];
    if (!entry) return undefined;
    return entry instanceof Error ? entry : new Error(String(entry));
  }
  return undefined;
}

/**
 * Provenance headers. `x-session-id` cannot be baked in once at load time
 * because it changes on `/fork`, `/new` and `/resume`; pi's per-request
 * `before_provider_headers` hook means it never needs to be, and hosts
 * without that event re-bake it here on every `session_start`, which is what
 * covers those same transitions.
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

    const getProvider = registry.getProvider?.bind(registry);
    void proxyRuntime
      .sync({
        ...(getProvider
          ? {
              native: {
                getProvider,
                registerNativeProvider: (provider: Provider) =>
                  pi.registerProvider(provider),
              },
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
      })
      .catch((error: unknown) => {
        // A host that refuses one registration must not take the session with
        // it: without this the rejection is unhandled and the run aborts.
        ctx.ui.notify(
          `[aperture] proxy provider sync failed: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
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
        // Re-pick first. It must not be skippable by a surprise in the
        // refresh result's shape below, and on hosts that bake registration
        // headers into model configs it is what makes the current session's
        // `x-session-id` ship. Idempotent where the per-request header hook
        // exists, so it runs unconditionally.
        //
        // `ctx` accessors throw once the runner is invalidated (session
        // replacement or reload). A refresh that outlives its session has
        // nothing left to re-pick, so treat that as done, not as an error --
        // reporting it would touch the same dead `ctx`.
        try {
          const active = ctx.model;
          if (active?.provider === DEDICATED_PROVIDER_ID) {
            const updated = registry.find(active.provider, active.id);
            if (updated) {
              void pi.setModel(updated).catch(() => {});
            }
          }
        } catch {
          return;
        }

        // Per-provider refresh errors resolve rather than reject; relay them.
        // The result shape is the host's, not ours, so narrow it instead of
        // asserting pi's `ModelsRefreshResult` onto an unknown.
        const error = refreshErrorFor(result, DEDICATED_PROVIDER_ID);
        if (error) {
          ctx.ui.notify(
            `[aperture] model refresh failed: ${error.message}`,
            "warning",
          );
        }
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
