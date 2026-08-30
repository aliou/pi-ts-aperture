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
 * Coerce whatever a host stored as an error into something with a message.
 *
 * Total by construction. The relay below runs before the model re-pick
 * specifically so nothing can suppress the gateway's error report, and a
 * throw here would suppress both: `JSON.stringify` alone throws on a cyclic
 * structure, on a `BigInt`, and on a getter that throws.
 */
function toError(value: unknown): Error | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  if (typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
    // Host entries commonly nest the real failure, and an `Error` value
    // serialises to `{}` because its properties are not enumerable, so
    // unwrap before falling back to stringification.
    for (const key of ["error", "cause", "reason"]) {
      const nested: unknown = (value as Record<string, unknown>)[key];
      if (nested !== undefined && nested !== value) {
        const unwrapped = toError(nested);
        if (unwrapped) return unwrapped;
      }
    }
  }
  let described: string;
  try {
    described = JSON.stringify(value) ?? String(value);
  } catch {
    described = String(value);
  }
  return new Error(described || `unserialisable ${typeof value} error`);
}

/**
 * Pull this provider's refresh error out of whatever the host's refresh
 * resolved to. pi resolves a `ModelsRefreshResult` whose `errors` is a `Map`
 * of `Error`; `refreshProvider` is another host's API with an unpinned shape,
 * so accept a record or an array too, normalise the entry either way, and
 * stay quiet on anything unrecognised rather than throwing a client bug into
 * the gateway's error channel.
 */
function refreshErrorFor(result: unknown, id: string): Error | undefined {
  // Property reads on a host-supplied object can themselves throw (a getter,
  // a proxy bound to a dead context), and this runs ahead of the re-pick.
  try {
    const errors = (result as { errors?: unknown } | undefined)?.errors;
    if (!errors || typeof errors !== "object") return undefined;
    if (errors instanceof Map) return toError(errors.get(id));
    if (Array.isArray(errors)) {
      return toError(
        errors.find((e) => (e as { provider?: unknown })?.provider === id),
      );
    }
    return toError((errors as Record<string, unknown>)[id]);
  } catch {
    return undefined;
  }
}

/**
 * Provenance headers. `x-session-id` changes on `/fork`, `/new` and
 * `/resume`, so it cannot be baked in once at load time. pi's per-request
 * `before_provider_headers` hook means it never needs to be; hosts without
 * that event get it from the registrations `onSync` performs, which is only
 * as current as the last session event that reached `onSync` (see the
 * subscriptions at the bottom of the factory).
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

  // Session transitions and settings saves both call `onSync`, and its work
  // continues asynchronously after it returns, so two can overlap. Only the
  // newest may act on what it finds: an older one finishing last would
  // re-select a model or relay an error for a session that has moved on.
  let syncGeneration = 0;

  const onSync = (ctx: ExtensionContext): void => {
    syncGeneration += 1;
    const generation = syncGeneration;
    const isCurrent = (): boolean => generation === syncGeneration;
    updateKnownModels(ctx);
    emitConfigSync();
    const config = configLoader.getConfig();
    const registry = ctx.modelRegistry as HostModelRegistry;
    const headers = provenanceHeaders(ctx);

    // Every `ctx` accessor throws once the runner is invalidated (session
    // replacement or reload), so an async continuation that reports through
    // `ctx.ui` turns one dead-context throw into a second, unhandled one.
    // A message for a session that no longer exists has nowhere to go.
    const notifyIfLive = (msg: string, type: "warning" | "info"): void => {
      try {
        ctx.ui.notify(msg, type);
      } catch {
        // The session this message belonged to is gone; nobody left to tell.
        return;
      }
    };

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
        unregisterProvider: (name) => pi.unregisterProvider(name),
        getModels: () => registry.getAll(),
        headers,
        notify: notifyIfLive,
      })
      .then(() => {
        if (!isCurrent()) return;
        const active = ctx.model;
        if (!active) return;
        const updated = registry.find(active.provider, active.id);
        if (updated && nextProxyProviders.includes(active.provider)) {
          // `sync()` may have left this provider un-proxied (a passthrough
          // provider it cannot express), in which case the host still holds
          // the upstream definition and `setModel` can reject on its
          // credential. Report it rather than leaking a rejection.
          void Promise.resolve()
            .then(() => pi.setModel(updated))
            .catch((error: unknown) => {
              notifyIfLive(
                `[aperture] could not re-select ${active.provider}/${active.id}: ${error instanceof Error ? error.message : String(error)}`,
                "warning",
              );
            });
        }
      })
      .catch((error: unknown) => {
        // A host that refuses one registration must not take the session with
        // it: without this the rejection is unhandled and the run aborts.
        // Reporting must not re-throw either, hence `notifyIfLive` -- a sync
        // that outlived its session lands here via the `ctx.model` read above.
        notifyIfLive(
          `[aperture] proxy provider sync failed: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      });

    void proxyRuntime
      .checkMissingModels({
        getModels: () => registry.getAll(),
        notify: notifyIfLive,
      })
      .catch((error: unknown) => {
        // Gateway failures never reach here (`fetchProviders` absorbs them),
        // so anything that does is a client or host-contract bug. Report it
        // rather than leaving the check silently not running.
        notifyIfLive(
          `[aperture] could not check which models the gateway serves: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      });

    // `notifyIfLive`, not a raw `ctx.ui.notify`: the host retains this closure
    // inside `refreshModels` and `fetchDynamicModels` and calls it on its own
    // schedule, so it outlives the session by longer than any other handler
    // here. A dead-context throw from a cosmetic warning would reject the
    // catalog fetch and empty the model picker.
    reconcileDedicatedProvider(
      pi,
      getRegistryModels,
      (msg) => notifyIfLive(msg, "warning"),
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
        if (!isCurrent()) return;

        // Relay first, in its own scope. `refreshErrorFor` is total and
        // `notifyIfLive` cannot throw, so nothing below can suppress the
        // gateway's own error report -- the only channel this wires for it.
        const error = refreshErrorFor(result, DEDICATED_PROVIDER_ID);
        if (error) {
          notifyIfLive(
            `[aperture] model refresh failed: ${error.message}`,
            "warning",
          );
        }

        // Then re-pick: on hosts that bake registration headers into model
        // configs this is what makes the current session's `x-session-id`
        // ship. Idempotent where the per-request header hook exists, so it
        // runs unconditionally.
        //
        // Only the `ctx.model` read is guarded, and only because that getter
        // throws once the runner is invalidated: a refresh that outlived its
        // session has nothing left to re-pick. `registry` was captured while
        // active and has no such guard, so a throw from `find` is a real bug
        // and must reach the rejection handler.
        let active: ExtensionContext["model"];
        try {
          active = ctx.model;
        } catch {
          return;
        }
        if (active?.provider !== DEDICATED_PROVIDER_ID) return;
        const updated = registry.find(active.provider, active.id);
        if (!updated) return;
        // `Promise.resolve().then(...)` so a host that validates eagerly and
        // throws synchronously reaches this handler, which names the re-pick,
        // rather than the enclosing one, which would blame the refresh.
        void Promise.resolve()
          .then(() => pi.setModel(updated))
          .catch((rejection: unknown) => {
            notifyIfLive(
              `[aperture] could not re-select ${active?.provider}/${active?.id}: ${rejection instanceof Error ? rejection.message : String(rejection)}`,
              "warning",
            );
          });
      })
      .catch((error: unknown) => {
        notifyIfLive(
          `[aperture] dedicated model refresh could not complete: ${error instanceof Error ? error.message : String(error)}`,
          "warning",
        );
      });
  };

  const onSessionEvent = (_event: unknown, ctx: ExtensionContext): void => {
    loadedFeatures.clear();
    pi.events.emit(
      APERTURE_FEATURE_REQUEST_EVENT,
      createFeatureRequestPayload(),
    );
    onSync(ctx);
  };

  pi.on("session_start", onSessionEvent);
  // Hosts that bake the provenance headers into registrations only refresh
  // them when `onSync` runs, so every transition that changes the session id
  // has to reach it. pi routes `/fork`, `/new` and `/resume` back through
  // `session_start` and sets the header per request anyway; the fork emits
  // `session_switch` (new/resume) and `session_branch` (fork) separately.
  // `pi.on` stores handlers for event names a host does not know, so
  // subscribing to both is inert where they do not exist.
  pi.on("session_switch" as "session_start", onSessionEvent);
  pi.on("session_branch" as "session_start", onSessionEvent);

  registerApertureSettings(pi, onSync, () => knownModels);
  registerOnboarding(pi);
}
