import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import {
  embedsModelIdInPath,
  getBaseUrlForApi,
} from "../../../src/base-url-routing";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../../src/url";
import { isSelectableApi } from "../../shared/api-selection";
import { configLoader } from "../../shared/config/loader";
import type { ResolvedConfig } from "../../shared/config/types";
import type {
  Api,
  CheckDeps,
  Model,
  Provider,
  ProviderModelConfig,
  SyncDeps,
} from "../../shared/types";

const MAX_MISSING_MODELS_PER_PROVIDER = 5;

function qualifyModelId<T extends Api>(
  providerName: string,
  model: Model<T>,
): Model<T> {
  // Path-embedding APIs (Gemini/Vertex/Bedrock) put the model id in the URL,
  // which the gateway forwards verbatim upstream; qualifying it 404s. Body
  // APIs keep the qualified id so the gateway can disambiguate duplicates.
  if (embedsModelIdInPath(model.api)) return model;
  // Skip re-prefixing an id a stale pre-reload wrapper already prefixed.
  const prefix = `${providerName}/`;
  if (model.id.startsWith(prefix)) return model;
  return { ...model, id: `${prefix}${model.id}` };
}

/**
 * Project a registry model onto the host's provider-config model shape, for
 * hosts that register providers by name + config rather than natively.
 */
function toProviderModelConfig(model: Model<Api>): ProviderModelConfig {
  return {
    id: model.id,
    name: model.name,
    reasoning: model.reasoning,
    ...(model.thinkingLevelMap
      ? { thinkingLevelMap: model.thinkingLevelMap }
      : {}),
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(model.headers ? { headers: model.headers } : {}),
    ...(model.compat ? { compat: model.compat } : {}),
  };
}

export class ApertureRuntime {
  // Upstream provider base URLs captured on first registration. A settings
  // reload re-runs sync, but by then the model list is already rewritten to
  // the Aperture gateway (providerModels[0].baseUrl is the gateway URL), so
  // the upstream /v1 shape can no longer be read from the live models. The
  // cache keeps the first inferred value stable across re-syncs.
  private readonly upstreamBaseUrls = new Map<string, string>();

  // The provider as seen at the first sync. From the second sync onwards
  // deps.getProvider returns our own wrapped provider, whose getModels() is
  // already gateway-filtered, so filtering and flag toggles need the
  // first-seen provider to keep reading the unfiltered model list.
  private readonly firstSeenProviders = new Map<string, Provider>();

  // Provider models as seen at the first sync, before rerouting. Same
  // rationale as firstSeenProviders: from the second sync on, getModels()
  // returns our own registrations, whose baseUrl is the gateway and whose api
  // may already be an override, so the upstream shape has to come from here.
  private readonly firstSeenModels = new Map<string, readonly Model<Api>[]>();

  // Passthrough provider ids (`auth_mode: "passthrough"`); refreshed each
  // sync from the gateway catalog.
  private passthroughProviderIds = new Set<string>();

  // Providers this runtime registered through the config path. A config
  // registration outlives the sync that made it, so a provider that later
  // turns out to be passthrough has to be actively undone, not just skipped.
  private readonly configRegistered = new Set<string>();

  async sync(deps: SyncDeps): Promise<void> {
    const config = configLoader.getConfig();
    if (!config.proxy.enabled) return;
    const upstreamProviders = config.proxy.upstreamProviders.filter(
      (p) => p.enabled !== false,
    );
    if (!config.baseUrl || upstreamProviders.length === 0) return;

    const gatewayRoot = resolveGatewayUrl(config);
    const baseUrl = resolveProviderBaseUrl(config);
    if (!gatewayRoot || !baseUrl) return;

    const nativeDeps = deps.native;

    // One catalog fetch per sync serves passthrough detection and model
    // filtering. A failure is not the same as a gateway that serves nothing:
    // the difference decides whether the config branch may register at all.
    const catalog = await this.fetchProviders(gatewayRoot);
    const fetched = "providers" in catalog ? catalog.providers : undefined;
    if (!("providers" in catalog)) {
      // Name the cause -- a 401 needs re-auth, a timeout needs patience, and
      // "could not reach" misdirects for both -- and say what follows, which
      // differs by branch and is not merely cosmetic either way.
      const reason =
        catalog.error instanceof Error
          ? catalog.error.message
          : String(catalog.error);
      deps.notify?.(
        nativeDeps
          ? `[aperture] could not read the gateway catalog at ${gatewayRoot}: ${reason}. Gateway-model filtering and api overrides are skipped this sync, and a provider needing the client's own credential cannot be detected, so it will be sent a placeholder credential and may fail auth.`
          : `[aperture] could not read the gateway catalog at ${gatewayRoot}: ${reason}. No provider is rerouted through the gateway this sync, so requests go straight to their own upstreams.`,
        "warning",
      );
    }
    const providers = fetched ?? [];
    this.passthroughProviderIds = new Set(
      providers.filter((p) => p.requires_client_auth).map((p) => p.id),
    );

    const filterableIds = new Set(
      upstreamProviders.filter((p) => p.keepGatewayModelsOnly).map((p) => p.id),
    );
    const configByProvider = new Map(upstreamProviders.map((p) => [p.id, p]));
    const gatewayModelIds = new Map(
      providers.map((p) => [p.id, new Set(p.models)]),
    );
    const compatibilityByProvider = new Map(
      providers.map((p) => [p.id, p.compatibility]),
    );

    const allModels = deps.getModels();
    const providerIds = upstreamProviders
      .map((p) => p.id)
      .filter((id) => id !== "aperture");

    for (const providerName of providerIds) {
      const providerModels = allModels.filter(
        (m) => m.provider === providerName,
      );
      if (providerModels.length === 0) continue;

      const sourceModel = providerModels[0];

      // If the live model URL is already the gateway itself, the upstream
      // shape was overwritten by a prior sync; reuse the cached upstream URL
      // instead of re-deriving it from the gateway URL.
      const liveBaseUrl = sourceModel.baseUrl;
      const isAlreadyGateway =
        liveBaseUrl === gatewayRoot || liveBaseUrl === baseUrl;
      const upstreamBaseUrl = isAlreadyGateway
        ? this.upstreamBaseUrls.get(providerName)
        : liveBaseUrl;
      if (!isAlreadyGateway && upstreamBaseUrl) {
        this.upstreamBaseUrls.set(providerName, upstreamBaseUrl);
      }

      // Referer and x-session-id are injected per-request via the
      // `before_provider_headers` hook registered in the extension entry
      // point on hosts that have it; hosts without it get `deps.headers`
      // baked into the config registration below.
      //
      // On hosts with native providers, re-register via the NATIVE path
      // (passing a wrapped Provider object) rather than the config path. Pi's
      // config-path registerProvider deletes the extension-native provider
      // entry from the model runtime, which leaves no `base` for the composer
      // to rewrite model baseUrls, so requests keep their baked upstream URL
      // and bypass the gateway. Builtins (zai) survive because their built-in
      // registration still resolves; these providers are extension-native, so
      // we preserve them by re-registering a wrapped provider whose
      // getModels() returns gateway-rewritten models.
      const native = nativeDeps?.getProvider(providerName);
      if (nativeDeps && !native) continue;

      let firstSeen: Provider | undefined;
      if (native) {
        firstSeen = this.firstSeenProviders.get(providerName) ?? native;
        this.firstSeenProviders.set(providerName, firstSeen);
      }

      let seenModels: readonly Model<Api>[];
      if (firstSeen) {
        seenModels = firstSeen.getModels();
      } else {
        seenModels = this.firstSeenModels.get(providerName) ?? providerModels;
        this.firstSeenModels.set(providerName, seenModels);
      }

      const sourceApi =
        seenModels[0]?.api ?? sourceModel.api ?? "openai-completions";
      const override = configByProvider.get(providerName)?.api;
      const compatibility = compatibilityByProvider.get(providerName);
      let apiOverride: Api | undefined;
      if (override && compatibility !== undefined) {
        if (isSelectableApi(override, compatibility)) {
          apiOverride = override;
        } else {
          deps.notify?.(
            `[aperture] api override "${override}" for proxied provider ${providerName} is not served by the gateway; falling back to the provider's own api (${sourceApi}).`,
            "warning",
          );
        }
      }
      const api = apiOverride ?? sourceApi;

      const providerBaseUrl = getBaseUrlForApi(
        api,
        gatewayRoot,
        baseUrl,
        upstreamBaseUrl,
      );

      const servedIds = filterableIds.has(providerName)
        ? gatewayModelIds.get(providerName)
        : undefined;
      const selected =
        servedIds === undefined
          ? seenModels
          : seenModels.filter((model) => servedIds.has(model.id));
      const isPassthrough = this.passthroughProviderIds.has(providerName);

      if (nativeDeps && native && firstSeen) {
        // Exactly the pre-change guard: skip only on an empty *filtered*
        // list. An unfiltered provider whose live getModels() is momentarily
        // empty must still be re-registered, or a dynamic provider loses its
        // gateway routing.
        if (servedIds !== undefined && selected.length === 0) continue;

        const baseAuth = firstSeen.auth?.apiKey;
        const wrapped: Provider = {
          ...native,
          id: providerName,
          getModels: () =>
            (servedIds === undefined
              ? firstSeen.getModels()
              : firstSeen.getModels().filter((model) => servedIds.has(model.id))
            ).map((model) => ({
              ...model,
              ...(apiOverride ? { api: apiOverride } : {}),
              baseUrl: providerBaseUrl,
            })),
          // Delegate through `firstSeen`, not `native`: from the second sync
          // onwards `native` is our own previous wrapper, so routing its
          // streams would double-qualify the model id. Same rationale as
          // getModels() above.
          stream: (model, context, options) =>
            firstSeen.stream(
              qualifyModelId(providerName, model),
              context,
              options,
            ),
          streamSimple: (model, context, options) =>
            firstSeen.streamSimple(
              qualifyModelId(providerName, model),
              context,
              options,
            ),
          // Override/none providers: the gateway injects the upstream credential,
          // so a placeholder key keeps them surfaced in the model picker.
          // Passthrough providers keep native auth so the client sends a real
          // credential the gateway forwards.
          auth:
            firstSeen.auth && baseAuth && !isPassthrough
              ? {
                  ...firstSeen.auth,
                  apiKey: {
                    ...baseAuth,
                    check: async () => ({
                      type: "api_key",
                      source: "aperture proxy",
                    }),
                    resolve: async () => ({
                      auth: { apiKey: "-" },
                      source: "aperture proxy",
                    }),
                  },
                }
              : firstSeen.auth,
        };
        nativeDeps.registerNativeProvider(wrapped);
        continue;
      }

      // Hosts without native providers: name+config registration, which
      // merges by model id rather than replacing the provider's catalog.
      // Keep the upstream ids so the merge overwrites the provider's own
      // definitions and every model reroutes: qualifying them here would add
      // a second, gateway-bound copy of each model beside the untouched
      // upstream one, and the picker would offer both. That costs the
      // gateway's bare-id resolution (it lowercases and can mispick among
      // duplicate registrations), which is the price of rerouting a provider
      // on a host with no per-provider stream hook to rewrite ids at request
      // time.
      //
      // A passthrough provider cannot be expressed here at all. Its whole
      // point is that the client sends its own credential, and a config
      // registration can only carry a literal/env/command `apiKey` - there is
      // no way to say "resolve this provider's native auth". A host rejects a
      // registration that defines models with neither `apiKey` nor `oauth`,
      // so attempting one only produces a contained warning for a case we
      // already know cannot work. Skipping is not enough on its own either: a
      // config registration outlives the sync that made it, so a provider we
      // already rerouted (or misclassified while the catalog was unreachable)
      // must be actively unregistered, restoring its own model definitions.
      if (isPassthrough) {
        const restored = this.restoreOwnRouting(providerName, deps);
        deps.notify?.(
          `[aperture] ${providerName} needs the client's own credential (passthrough), which this host cannot express in a provider config; ${restored ? "restored its own routing" : "leaving it un-proxied"}.`,
          "warning",
        );
        continue;
      }

      // Rerouting needs positive evidence that this provider is served and
      // is not passthrough, and only the catalog carries it. An absent
      // catalog is one way to lack that evidence; a catalog that simply does
      // not list the provider (disabled upstream, or none of its models
      // reach `/v1/models`) is the other, and both used to end in a
      // registration with `apiKey: "-"` on an assumption nothing checked.
      // Refusing a new registration is not enough either: an earlier sync's
      // registration is still installed, so undo it.
      const inCatalog = gatewayModelIds.has(providerName);
      if (fetched === undefined || !inCatalog) {
        const restored = this.restoreOwnRouting(providerName, deps);
        if (restored) {
          deps.notify?.(
            `[aperture] restored ${providerName} to its own routing: the gateway catalog no longer confirms it is served.`,
            "warning",
          );
        } else if (fetched !== undefined) {
          deps.notify?.(
            `[aperture] the gateway does not list ${providerName}, so it stays on its own upstream routing.`,
            "warning",
          );
        }
        continue;
      }

      // `keepGatewayModelsOnly` cannot hide anything here: config registration
      // merges, so the models we leave out keep their upstream definitions
      // instead of disappearing. Say so rather than pretending it filtered.
      if (servedIds !== undefined && selected.length < seenModels.length) {
        deps.notify?.(
          `[aperture] keepGatewayModelsOnly cannot hide models on this host; ${seenModels.length - selected.length} ${providerName} model(s) the gateway does not serve stay registered upstream.`,
          "warning",
        );
      }

      // Nothing left to register, but only after the warnings above: a fully
      // filtered provider is exactly the case a user most needs told.
      if (selected.length === 0) continue;

      try {
        deps.registerProviderConfig(providerName, {
          baseUrl: providerBaseUrl,
          apiKey: "-",
          ...(deps.headers ? { headers: deps.headers } : {}),
          models: selected.map((model) => {
            // Per model, not per provider: a provider can span APIs (pi's own
            // `openai` provider carries both completions and responses
            // models), and the native branch preserves each model's own api.
            const modelApi = apiOverride ?? model.api ?? sourceApi;
            return {
              ...toProviderModelConfig(model),
              api: modelApi,
              baseUrl: getBaseUrlForApi(
                modelApi,
                gatewayRoot,
                baseUrl,
                upstreamBaseUrl,
              ),
            };
          }),
        });
        this.configRegistered.add(providerName);
      } catch (error) {
        // One provider the host refuses must not cost the rest of the list.
        // The host owns whether a refused registration left anything behind,
        // so do not promise a clean rollback here.
        deps.notify?.(
          `[aperture] the host refused the gateway registration for ${providerName}: ${error instanceof Error ? error.message : String(error)}. It may be left partly registered; reload if its models misbehave.`,
          "warning",
        );
      }
    }
  }

  /**
   * Undo a config registration this runtime made, putting the provider back
   * on its own model definitions. Returns whether anything was undone.
   *
   * The bookkeeping is committed only after the host call returns: dropping
   * the entry first would mean a refused unregister is never retried, while
   * the host still holds a gateway registration sending a placeholder
   * credential. Contained per provider for the same reason the registration
   * path is — one refusal must not cost the rest of the list.
   */
  private restoreOwnRouting(providerName: string, deps: SyncDeps): boolean {
    if (!this.configRegistered.has(providerName)) return false;
    try {
      deps.unregisterProvider(providerName);
      this.configRegistered.delete(providerName);
      return true;
    } catch (error) {
      deps.notify?.(
        `[aperture] the host refused to undo ${providerName}'s gateway registration: ${error instanceof Error ? error.message : String(error)}. It is still routed through the gateway with a placeholder credential and its requests may fail auth; reload to restore it.`,
        "warning",
      );
      return false;
    }
  }

  /**
   * Fetch the gateway catalog. The result distinguishes "could not fetch"
   * from "the gateway lists nothing", which the callers treat differently:
   * the native branch keeps its historical fail-open, the config branch
   * refuses to guess a provider's auth mode without the catalog. The cause
   * travels with the failure because it decides the user's next action -- a
   * 401 means re-auth, a timeout means the link, a SyntaxError means
   * something is intercepting the request.
   */
  private async fetchProviders(
    gatewayRoot: string,
  ): Promise<{ providers: ApertureProvider[] } | { error: unknown }> {
    try {
      return { providers: await new ApertureClient(gatewayRoot).providers() };
    } catch (error) {
      return { error };
    }
  }

  async checkMissingModels(
    deps: CheckDeps,
    providers?: ApertureProvider[],
  ): Promise<void> {
    const config = configLoader.getConfig();
    if (!config.proxy.enabled) return;

    const checkedProviderIds = config.proxy.upstreamProviders
      .filter((p) => p.enabled !== false)
      .filter((p) => p.shouldCheckGatewayModels)
      .map((p) => p.id);
    if (checkedProviderIds.length === 0) return;

    const gatewayUrl = resolveGatewayUrl(config);
    if (!gatewayUrl && !providers) return;

    let gatewayProviders = providers;
    if (!gatewayProviders) {
      // Best-effort, warning-only: a gateway failure must never propagate (the
      // caller fires-and-forgets this promise) and crash Pi.
      const catalog = await this.fetchProviders(gatewayUrl as string);
      gatewayProviders = "providers" in catalog ? catalog.providers : undefined;
    }
    if (!gatewayProviders || gatewayProviders.length === 0) return;

    const modelIdsByProvider = new Map(
      gatewayProviders.map((provider) => [
        provider.id,
        new Set(provider.models),
      ]),
    );

    const allModels = deps.getModels();
    const checkedProviders = new Set(checkedProviderIds);
    const routedModels = allModels.filter((m) =>
      checkedProviders.has(m.provider),
    );
    const missingModels = routedModels.filter(
      (m) => !modelIdsByProvider.get(m.provider)?.has(m.id),
    );

    if (missingModels.length === 0) return;

    const missingByProvider = new Map<string, Model<Api>[]>();
    for (const model of missingModels) {
      const providerModels = missingByProvider.get(model.provider) ?? [];
      providerModels.push(model);
      missingByProvider.set(model.provider, providerModels);
    }

    const summary = Array.from(missingByProvider.entries())
      .map(([provider, models]) => {
        const shownModels = models
          .slice(0, MAX_MISSING_MODELS_PER_PROVIDER)
          .map((m) => m.id);
        const remainingCount = models.length - shownModels.length;
        const more = remainingCount > 0 ? `, ${remainingCount} more` : "";
        return `${provider}: ${shownModels.join(", ")}${more}`;
      })
      .join("; ");

    deps.notify(
      `[aperture] models not available on gateway: ${summary}. Add them to the gateway configuration.`,
      "warning",
    );
  }

  getProvidersToUnregister(
    prevProviders: string[],
    nextProviders: string[],
  ): string[] {
    return prevProviders.filter((p) => !nextProviders.includes(p));
  }

  /**
   * Resolves the proxy provider sync diff for the current config.
   *
   * `next` is the up-to-date list of proxy provider ids to track, and
   * `unregister` is the subset of previously-registered providers that are no
   * longer proxied and should be unregistered.
   *
   * When proxy is disabled, returns an empty `unregister` list and keeps
   * `next` equal to `lastProxyProviders`. Providers stay registered even if
   * the config still lists upstream provider ids, so toggling proxy off does
   * not tear down providers that were set up by a previous proxy-enabled
   * session (and does not surface spurious "unregistered" notifications).
   */
  resolveProxyProviderSync(
    config: ResolvedConfig,
    lastProxyProviders: string[],
  ): { next: string[]; unregister: string[] } {
    if (!config.proxy.enabled) {
      return { next: lastProxyProviders, unregister: [] };
    }
    const next = config.proxy.upstreamProviders
      .filter((p) => p.enabled !== false)
      .map((p) => p.id);
    return {
      next,
      unregister: this.getProvidersToUnregister(lastProxyProviders, next),
    };
  }
}
