import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import { getBaseUrlForApi } from "../../../src/base-url-routing";
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
  return { ...model, id: `${providerName}/${model.id}` };
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

  // Provider models as seen at the first sync, before id qualification. Same
  // rationale as firstSeenProviders: from the second sync on, getModels()
  // returns our own rewritten models.
  private readonly firstSeenModels = new Map<string, readonly Model<Api>[]>();

  // Passthrough provider ids (`auth_mode: "passthrough"`); refreshed each
  // sync from the gateway catalog.
  private passthroughProviderIds = new Set<string>();

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

    // Native provider access is optional: hosts whose registry has no
    // getProvider register by name + config instead.
    const nativeDeps =
      deps.getProvider && deps.registerNativeProvider
        ? {
            getProvider: deps.getProvider,
            registerNativeProvider: deps.registerNativeProvider,
          }
        : undefined;

    // One catalog fetch per sync serves passthrough detection and model
    // filtering.
    const providers = await this.fetchProviders(gatewayRoot);
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
      if (selected.length === 0) continue;

      const isPassthrough = this.passthroughProviderIds.has(providerName);

      if (nativeDeps && native && firstSeen) {
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
      deps.registerProviderConfig(providerName, {
        baseUrl: providerBaseUrl,
        // Passthrough providers must keep sending the client's own credential.
        ...(isPassthrough ? {} : { apiKey: "-" }),
        ...(deps.headers ? { headers: deps.headers } : {}),
        models: selected.map((model) => ({
          ...toProviderModelConfig(model),
          api,
          baseUrl: providerBaseUrl,
        })),
      });
    }
  }

  /** Fetch the gateway catalog, failing open to an empty list. */
  private async fetchProviders(
    gatewayRoot: string,
  ): Promise<ApertureProvider[]> {
    try {
      return await new ApertureClient(gatewayRoot).providers();
    } catch {
      return [];
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
      gatewayProviders = await this.fetchProviders(gatewayUrl as string);
    }
    if (gatewayProviders.length === 0) return;

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
