import { type AnyModel, isModelType } from "@earendil-works/pi-ai";
import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import { getBaseUrlForApi } from "../../../src/base-url-routing";
import { resolveModelMetadata } from "../../../src/model-metadata";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../../src/url";
import { buildStream, buildStreamSimple } from "../../shared/api-routing";
import { isSelectableApi } from "../../shared/api-selection";
import { configLoader } from "../../shared/config/loader";
import type {
  ProxiedProviderConfig,
  ResolvedConfig,
} from "../../shared/config/types";
import type {
  Api,
  CheckDeps,
  Model,
  Provider,
  SyncDeps,
} from "../../shared/types";
import { DEDICATED_PROVIDER_ID } from "../dedicated/provider";
import {
  buildGatewayChatModel,
  UNCATALOGUED_NAME_SUFFIX,
} from "../gateway-models";
import { qualifyModelId, withModelId, withRequestModelId } from "./model-id";
import { OPENAI_BASE_URL, withOpenAIGatewayFetch } from "./openai-passthrough";

const MAX_MISSING_MODELS_PER_PROVIDER = 5;

/** `provider: id, id, … (N more); …` for a drift notification. */
function summarizeDiffs(byProvider: Map<string, string[]>): string {
  return Array.from(byProvider.entries())
    .map(([provider, ids]) => {
      const shown = ids.slice(0, MAX_MISSING_MODELS_PER_PROVIDER);
      const remaining = ids.length - shown.length;
      const more = remaining > 0 ? `, ${remaining} more` : "";
      return `${provider}: ${shown.join(", ")}${more}`;
    })
    .join("; ");
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
    // Metadata matching for synthesized models. The dedicated provider's own
    // entries are excluded: they carry the safe defaults from a previous sync
    // and would shadow real registry metadata.
    const metadataRegistry = allModels.filter(
      (model): model is Model<Api> =>
        isModelType(model, "chat") && model.provider !== DEDICATED_PROVIDER_ID,
    );
    const providerIds = upstreamProviders
      .map((p) => p.id)
      .filter((id) => id !== DEDICATED_PROVIDER_ID);
    const configByProvider = new Map(upstreamProviders.map((p) => [p.id, p]));
    const registered = new Map<string, Provider>();
    const warnedUnknown = new Set<string>();

    const registerProviders = (
      providers?: ApertureProvider[],
      catalogSettled = false,
    ): void => {
      const catalogIds = new Set((providers ?? []).map((p) => p.id));
      const gatewayModelIds = new Map(
        (providers ?? []).map((p) => [p.id, new Set(p.models)]),
      );
      const compatibilityByProvider = new Map(
        (providers ?? []).map((p) => [p.id, p.compatibility]),
      );
      const gatewayProviderById = new Map(
        (providers ?? []).map((p) => [p.id, p]),
      );

      for (const providerName of providerIds) {
        const entry = configByProvider.get(providerName);
        if (!entry) continue;
        const { gatewayId } = entry;
        if (
          providers &&
          (gatewayId === DEDICATED_PROVIDER_ID || !catalogIds.has(gatewayId))
        ) {
          if (!warnedUnknown.has(gatewayId)) {
            warnedUnknown.add(gatewayId);
            deps.notify?.(
              `[aperture] gateway provider "${gatewayId}" not found; provider "${providerName}" left unrouted.`,
              "warning",
            );
          }
          const original = this.firstSeenProviders.get(providerName);
          if (
            original &&
            (registered.has(providerName) ||
              deps.getProvider(providerName) !== original)
          ) {
            deps.registerNativeProvider(original);
          }
          continue;
        }
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
        const override = entry.api;
        const compatibility = compatibilityByProvider.get(gatewayId);
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

        const isPassthrough = this.passthroughProviderIds.has(gatewayId);
        // Preserve Pi's native ChatGPT sign-in detection. The adapter builds
        // the subscription-safe body before our fetch redirects it to Aperture.
        const useGatewayFetch =
          isPassthrough &&
          api === "openai-responses" &&
          upstreamBaseUrl === OPENAI_BASE_URL;
        const fetchGateway = useGatewayFetch ? gatewayRoot : undefined;
        const providerBaseUrl = useGatewayFetch
          ? OPENAI_BASE_URL
          : getBaseUrlForApi(api, gatewayRoot, baseUrl, upstreamBaseUrl);

        const servedIds =
          providers && entry.keepGatewayModelsOnly
            ? gatewayModelIds.get(gatewayId)
            : undefined;

        // `generateAdditionalModelsFromGateway`: expose gateway models Pi's
        // catalog does not list. Pi's catalog is curated and can lag the
        // gateway (or lack a model the gateway serves under a different
        // provider id), so the gateway is the source of truth for existence
        // while the registry only supplies capability metadata. Entries live
        // in this sync's closure: they are rebuilt on every sync and never
        // persisted, so they cannot be selected as the default model.
        const additionalModels: Model<Api>[] = [];
        const gatewayProvider = gatewayProviderById.get(gatewayId);
        if (
          providers &&
          entry.generateAdditionalModelsFromGateway === true &&
          gatewayProvider
        ) {
          const knownIds = new Set(
            (firstSeen.getAllModels?.() ?? firstSeen.getModels()).map(
              (model) => model.id,
            ),
          );
          for (const gatewayModelId of gatewayProvider.models) {
            if (knownIds.has(gatewayModelId)) continue;
            const modelInfo = gatewayProvider.modelInfoById[gatewayModelId];
            // Classifier-only routes have no chat surface to route here.
            if (modelInfo?.system_one === true) continue;
            additionalModels.push(
              buildGatewayChatModel({
                id: gatewayModelId,
                provider: providerName,
                name: gatewayModelId,
                nameSuffix: UNCATALOGUED_NAME_SUFFIX,
                api,
                baseUrl: providerBaseUrl,
                pricing: modelInfo?.pricing,
                limits: {
                  context_window_tokens: modelInfo?.context_window_tokens,
                  max_output_tokens: modelInfo?.max_output_tokens,
                },
                metadata: resolveModelMetadata(providerName, gatewayModelId, {
                  registryModels: metadataRegistry,
                  registryProviderIds: [providerName, gatewayId],
                  siblingMatch: true,
                }),
              }),
            );
          }
        }

        if (
          servedIds !== undefined &&
          additionalModels.length === 0 &&
          !(firstSeen.getAllModels?.() ?? firstSeen.getModels()).some((model) =>
            servedIds.has(model.id),
          )
        ) {
          // The synchronous pre-fetch registration may have exposed this
          // provider's unfiltered models. Re-register it empty once the gateway
          // confirms that none are callable.
          const existing = registered.get(providerName);
          if (existing) {
            existing.getModels = () => [];
            existing.getAllModels = () => [];
            deps.registerNativeProvider(existing);
          }
          continue;
        }
        const baseAuth = firstSeen.auth?.apiKey;
        if (!catalogSettled && !baseAuth) continue;

        // Chat models are rewritten to the route's api and base URL. Classifier
        // models keep their api but call the gateway. Everything else (image
        // models) keeps its own routing.
        const gatewayUrlFor = (api: Api) =>
          getBaseUrlForApi(api, gatewayRoot, baseUrl, upstreamBaseUrl);
        const routeModel = (model: AnyModel): AnyModel => {
          if (isModelType(model, "chat")) {
            return { ...model, api, baseUrl: providerBaseUrl };
          }
          if (isModelType(model, "classifier")) {
            return { ...model, baseUrl: gatewayUrlFor(model.api) };
          }
          return model;
        };
        const serveGatewayModels = (
          models: readonly AnyModel[],
        ): readonly AnyModel[] =>
          [
            ...(servedIds === undefined
              ? models
              : models.filter((model) => servedIds.has(model.id))),
            ...additionalModels,
          ].map(routeModel);
        const nativeClassify = firstSeen.classify;
        const wrapped: Provider = {
          // Avoid copying composed methods that delegate back to this wrapper.
          ...firstSeen,
          id: providerName,
          getModels: () =>
            serveGatewayModels(firstSeen.getModels()) as readonly Model<Api>[],
          getAllModels: () =>
            serveGatewayModels(
              firstSeen.getAllModels?.() ?? firstSeen.getModels(),
            ),
          classify: nativeClassify
            ? (model, context, options) =>
                nativeClassify(
                  qualifyModelId(gatewayId, {
                    ...model,
                    baseUrl: gatewayUrlFor(model.api),
                  }),
                  context,
                  options,
                )
            : undefined,
          // Delegate through `firstSeen`, not `native`: from the second sync
          // onwards `native` is our own previous wrapper, so routing its
          // streams would double-qualify the model id. Same rationale as
          // getModels() above.
          // With an api override the gateway owns the protocol translation, so
          // streams go through the api registry (dedicated-style). Delegating
          // would hit upstream stream layers pinned to their own api
          // (`Mismatched api`). Without an override the upstream still drives
          // the request, keeping its extension hooks.

          stream: (model, context, options) => {
            const streamFn = apiOverride ? buildStream() : firstSeen.stream;
            // Enforce the gateway URL: auth resolution (e.g. GitHub Copilot
            // OAuth) can rewrite model.baseUrl before the request reaches us.
            const requestModel = qualifyModelId(gatewayId, {
              ...model,
              baseUrl: providerBaseUrl,
            });
            const stream = streamFn(
              requestModel,
              withRequestModelId(context, model, requestModel),
              withOpenAIGatewayFetch(options, fetchGateway),
            );
            return withModelId(stream, model.id);
          },
          streamSimple: (model, context, options) => {
            const streamSimpleFn = apiOverride
              ? buildStreamSimple()
              : firstSeen.streamSimple;
            const requestModel = qualifyModelId(gatewayId, {
              ...model,
              baseUrl: providerBaseUrl,
            });
            const stream = streamSimpleFn(
              requestModel,
              withRequestModelId(context, model, requestModel),
              withOpenAIGatewayFetch(options, fetchGateway),
            );
            return withModelId(stream, model.id);
          },
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
    // Bail if the session was replaced while the fetch was in flight;
    // the refreshed ctx for the new session re-runs sync.
    if (deps.isStale?.()) return;
    if (providers) {
      this.passthroughProviderIds = new Set(
        providers.filter((p) => p.requires_client_auth).map((p) => p.id),
      );
    }
    registerProviders(providers, true);
  }

  /** Fetch the gateway catalog, failing open without treating failure as an empty catalog. */
  private async fetchProviders(
    gatewayRoot: string,
  ): Promise<ApertureProvider[] | undefined> {
    try {
      return await new ApertureClient(gatewayRoot).providers();
    } catch {
      return undefined;
    }
  }

  /**
   * Report model drift between the gateway catalog and the local model list.
   *
   * Forward (`shouldCheckGatewayModels`): local models the gateway does not
   * serve, which would fail at request time.
   *
   * Reverse: gateway models the local list does not expose. Suppressed per
   * provider by `generateAdditionalModelsFromGateway`, since enabling it removes
   * the drift by construction. The warning names that flag (and its settings
   * location) so the fix is discoverable.
   *
   * Advisory only: nothing is registered, filtered, or removed here.
   */
  async checkModelDrift(
    deps: CheckDeps,
    providers?: ApertureProvider[],
  ): Promise<void> {
    const config = configLoader.getConfig();
    if (!config.proxy.enabled) return;

    const enabledProviders = config.proxy.upstreamProviders.filter(
      (p) => p.enabled !== false,
    );
    const unfilteredProviders = enabledProviders.filter(
      (p) => p.shouldCheckGatewayModels,
    );
    const unreportedProviders = enabledProviders.filter(
      (p) => p.generateAdditionalModelsFromGateway !== true,
    );
    if (unfilteredProviders.length === 0 && unreportedProviders.length === 0) {
      return;
    }

    const gatewayUrl = resolveGatewayUrl(config);
    if (!gatewayUrl && !providers) return;

    let gatewayProviders = providers;
    if (!gatewayProviders) {
      // Best-effort, warning-only: a gateway failure must never propagate (the
      // caller fires-and-forgets this promise) and crash Pi.
      gatewayProviders = await this.fetchProviders(gatewayUrl as string);
      // Same stale-ctx guard as sync().
      if (deps.isStale?.()) return;
    }
    if (!gatewayProviders?.length) return;

    const modelIdsByProvider = new Map(
      gatewayProviders.map((provider) => [
        provider.id,
        new Set(provider.models),
      ]),
    );

    const allModels = deps.getModels();
    const localIdsByProvider = new Map<string, Set<string>>();
    for (const model of allModels) {
      const ids = localIdsByProvider.get(model.provider) ?? new Set<string>();
      ids.add(model.id);
      localIdsByProvider.set(model.provider, ids);
    }

    this.reportMissingOnGateway(
      deps,
      allModels,
      modelIdsByProvider,
      unfilteredProviders,
    );
    this.reportAdditionalGatewayModels(
      deps,
      localIdsByProvider,
      modelIdsByProvider,
      unreportedProviders,
    );
  }

  private reportMissingOnGateway(
    deps: CheckDeps,
    allModels: readonly AnyModel[],
    modelIdsByProvider: Map<string, Set<string>>,
    checkedProviders: readonly ProxiedProviderConfig[],
  ): void {
    if (checkedProviders.length === 0) return;

    const gatewayIdByLocalId = new Map(
      checkedProviders.map((provider) => [provider.id, provider.gatewayId]),
    );
    const missingByProvider = new Map<string, string[]>();
    for (const model of allModels) {
      const gatewayId = gatewayIdByLocalId.get(model.provider);
      if (gatewayId === undefined) continue;
      const served = modelIdsByProvider.get(gatewayId);
      if (!served || served.has(model.id)) continue;
      const ids = missingByProvider.get(model.provider) ?? [];
      ids.push(model.id);
      missingByProvider.set(model.provider, ids);
    }
    if (missingByProvider.size === 0) return;

    const summary = summarizeDiffs(missingByProvider);
    deps.notify(
      `[aperture] models not available on gateway: ${summary}. Add them to the gateway configuration.`,
      "warning",
    );
  }

  private reportAdditionalGatewayModels(
    deps: CheckDeps,
    localIdsByProvider: Map<string, Set<string>>,
    modelIdsByProvider: Map<string, Set<string>>,
    checkedProviders: readonly ProxiedProviderConfig[],
  ): void {
    if (checkedProviders.length === 0) return;

    const additionalByProvider = new Map<string, string[]>();
    for (const provider of checkedProviders) {
      const served = modelIdsByProvider.get(provider.gatewayId);
      if (!served) continue;
      const localIds = localIdsByProvider.get(provider.id) ?? new Set<string>();
      const additional = [...served].filter((id) => !localIds.has(id));
      if (additional.length === 0) continue;
      additionalByProvider.set(provider.id, additional);
    }
    if (additionalByProvider.size === 0) return;

    const summary = summarizeDiffs(additionalByProvider);
    deps.notify(
      `[aperture] gateway models missing from the Pi model list: ${summary}. Turn on "Add gateway-only models" for these providers in /aperture:settings (Proxy tab), or set generateAdditionalModelsFromGateway: true.`,
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
