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

    // Start the one catalog fetch used for passthrough detection, model
    // filtering, and API validation, but do not await it yet. session_start
    // fires sync without awaiting it, so providers needing gateway-injected
    // credentials must receive placeholder auth before this promise settles.
    const providersPromise = this.fetchProviders(gatewayRoot);

    const allModels = deps.getModels();
    const providerIds = upstreamProviders
      .map((p) => p.id)
      .filter((id) => id !== "aperture");
    const configByProvider = new Map(upstreamProviders.map((p) => [p.id, p]));
    const registered = new Map<string, Provider>();

    const registerProviders = (providers?: ApertureProvider[]): void => {
      const filterableIds = new Set(
        providers
          ? upstreamProviders
              .filter((p) => p.keepGatewayModelsOnly)
              .map((p) => p.id)
          : [],
      );
      const gatewayModelIds = new Map(
        (providers ?? []).map((p) => [p.id, new Set(p.models)]),
      );
      const compatibilityByProvider = new Map(
        (providers ?? []).map((p) => [p.id, p.compatibility]),
      );

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
        // point, so provider registration only needs the gateway URL and API
        // path here.
        //
        // Re-register via the NATIVE path (passing a wrapped Provider object)
        // rather than the config path. Pi's config-path registerProvider deletes
        // the extension-native provider entry from the model runtime, which
        // leaves no `base` for the composer to rewrite model baseUrls, so
        // requests keep their baked upstream URL and bypass the gateway.
        // Builtins (zai) survive because their built-in registration still
        // resolves; these providers are extension-native, so we preserve them by
        // re-registering a wrapped provider whose getModels() returns
        // gateway-rewritten models.
        const native = deps.getProvider(providerName);
        if (!native) continue;
        let firstSeen = this.firstSeenProviders.get(providerName);
        if (!firstSeen) {
          firstSeen = native;
          this.firstSeenProviders.set(providerName, native);
        }

        const sourceApi =
          firstSeen.getModels()[0]?.api ??
          sourceModel.api ??
          "openai-completions";
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
        if (
          servedIds !== undefined &&
          !firstSeen.getModels().some((model) => servedIds.has(model.id))
        ) {
          // The synchronous pre-fetch registration may have exposed this
          // provider's unfiltered models. Re-register it empty once the gateway
          // confirms that none are callable.
          const existing = registered.get(providerName);
          if (existing) {
            existing.getModels = () => [];
            deps.registerNativeProvider(existing);
          }
          continue;
        }
        const baseAuth = firstSeen.auth?.apiKey;
        if (providers === undefined && !baseAuth) continue;
        const isPassthrough =
          providers !== undefined &&
          this.passthroughProviderIds.has(providerName);
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
        const existing = registered.get(providerName);
        if (existing) {
          Object.assign(existing, wrapped);
          deps.registerNativeProvider(existing);
        } else {
          registered.set(providerName, wrapped);
          deps.registerNativeProvider(wrapped);
        }
      }
    };

    // This pass is intentionally synchronous: auth modes are provisionally
    // treated as gateway-managed and receive placeholder auth, while
    // catalog-dependent filtering and overrides remain inert.
    registerProviders();

    const providers = await providersPromise;
    this.passthroughProviderIds = new Set(
      providers.filter((p) => p.requires_client_auth).map((p) => p.id),
    );
    registerProviders(providers);
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
