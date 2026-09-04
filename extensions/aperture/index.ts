import type { AssistantMessage } from "@earendil-works/pi-ai";
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
import {
  reconcileDedicatedProvider,
  registerDedicatedProvider,
} from "./dedicated/runtime";
import { registerOnboarding } from "./onboarding";
import { ApertureRuntime } from "./proxy/runtime";
import { registerApertureSettings } from "./settings";

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
  pi.on("before_provider_headers", (event, ctx) => {
    event.headers.Referer = "https://pi.dev";
    event.headers["x-session-id"] = ctx.sessionManager.getSessionId();
  });

  // In proxy mode, completed assistant messages persist the
  // transport-qualified model id (`provider/model-id`, or doubled after a
  // re-wrap). On resume, `getModel(provider, id)` misses that qualified id
  // against the bare registry ids and Pi falls back to a default model.
  //
  // Unwind the transport prefix at write time so the persisted message
  // carries a bare public id — but ONLY for active proxied providers, and
  // only when a candidate id does not already resolve as a real registry
  // model. Some public registry ids legitimately begin with their provider id
  // (e.g. openrouter's `openrouter/auto`); unconditionally stripping those
  // corrupts them into non-existent ids (`auto`), reproducing the very resume
  // failure this fix targets. Testing candidates against the live registry
  // keeps provider-prefixed public ids intact while still unwinding transport
  // re-wraps.
  const normalizeModelId = (
    message: AssistantMessage,
    ctx: ExtensionContext,
  ): AssistantMessage => {
    const config = configLoader.getConfig();
    // Proxy-only scope: never touch messages from unproxied providers.
    if (!config.proxy.enabled) return message;
    const isProxied = config.proxy.upstreamProviders.some(
      (p) => p.id === message.provider && p.enabled !== false,
    );
    if (!isProxied) return message;

    const prefix = `${message.provider}/`;
    // Nothing to unwind when the id already lacks the transport prefix.
    if (!message.model.startsWith(prefix)) return message;

    // The un-stripped id is a real public registry model (e.g.
    // openrouter/auto): preserve it instead of unwinding it into a
    // non-existent id.
    if (ctx.modelRegistry.find(message.provider, message.model)) {
      return message;
    }

    // Unwind the transport prefix one segment at a time, preferring the
    // longest candidate that resolves as a real registry model. This
    // normalizes doubled ids (openai-codex/openai-codex/gpt-5.6-luna ->
    // gpt-5.6-luna) while leaving provider-prefixed public ids intact
    // (openrouter/openrouter/auto -> openrouter/auto, not auto).
    let candidate = message.model;
    while (candidate.startsWith(prefix)) {
      candidate = candidate.slice(prefix.length);
      if (ctx.modelRegistry.find(message.provider, candidate)) {
        return { ...message, model: candidate };
      }
    }

    // No candidate resolved (the registry has not loaded this model yet).
    // Fall back to the fully stripped id so the persisted message still
    // carries the bare public id, preserving the original persistence fix.
    return { ...message, model: candidate };
  };

  // Tag transient gateway failures so Pi's auto-retry picks them up. Pi
  // applies `message_end` replacements in place before the retry check runs.
  // Hooking the message rather than the provider also covers proxy mode.
  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const message = normalizeModelId(event.message, ctx);
    if (message.stopReason !== "error" || !message.errorMessage) {
      return message === event.message ? undefined : { message };
    }

    const errorMessage = markRetryableApertureError(message.errorMessage);
    if (!errorMessage) {
      return message === event.message ? undefined : { message };
    }

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

    const { next: nextProxyProviders, unregister } =
      proxyRuntime.resolveProxyProviderSync(config, lastProxyProviders);
    for (const provider of unregister) {
      pi.unregisterProvider(provider);
      ctx.ui.notify(`[aperture] unregistered ${provider}.`, "info");
    }
    lastProxyProviders = nextProxyProviders;

    void proxyRuntime
      .sync({
        getProvider: (id) => ctx.modelRegistry.getProvider(id),
        registerNativeProvider: (provider) => pi.registerProvider(provider),
        getModels: () => ctx.modelRegistry.getAll(),
        notify: (msg, type) => ctx.ui.notify(msg, type),
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

    reconcileDedicatedProvider(pi, getRegistryModels, (msg) =>
      ctx.ui.notify(msg, "warning"),
    );

    // Trigger the networked model refresh: Pi's own startup refresh runs
    // before extensions load, so the dedicated provider never sees it.
    // Built-in providers self-throttle, so this costs about one gateway
    // fetch. Refresh failures fall back to the stored catalog inside Pi.
    void ctx.modelRegistry
      .refresh()
      .then((result) => {
        // Per-provider refresh errors resolve rather than reject; relay them.
        const error = result?.errors?.get("aperture");
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
