import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import { shouldUseGatewayRoot } from "../../../src/base-url-routing";
import { configLoader } from "../../../src/shared/config/loader";
import type { ResolvedConfig } from "../../../src/shared/config/types";
import type {
  Api,
  CheckDeps,
  Model,
  SyncDeps,
} from "../../../src/shared/types";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../../src/url";

const MAX_MISSING_MODELS_PER_PROVIDER = 5;

export class ApertureRuntime {
  // Upstream provider base URLs captured on first registration. A settings
  // reload re-runs sync, but by then the model list is already rewritten to
  // the Aperture gateway (providerModels[0].baseUrl is the gateway URL), so
  // the upstream /v1 shape can no longer be read from the live models. The
  // cache keeps the first inferred value stable across re-syncs.
  private readonly upstreamBaseUrls = new Map<string, string>();

  async sync(deps: SyncDeps): Promise<void> {
    const config = configLoader.getConfig();
    if (!config.proxy.enabled) return;
    if (!config.baseUrl || config.proxy.upstreamProviders.length === 0) return;

    const gatewayRoot = resolveGatewayUrl(config);
    const baseUrl = resolveProviderBaseUrl(config);
    if (!gatewayRoot || !baseUrl) return;

    const allModels = deps.getModels();
    const providerIds = config.proxy.upstreamProviders
      .map((p) => p.id)
      .filter((id) => id !== "aperture");

    for (const providerName of providerIds) {
      const providerModels = allModels.filter(
        (m) => m.provider === providerName,
      );
      if (providerModels.length === 0) continue;

      const sourceModel = providerModels[0];
      const api = sourceModel.api ?? "openai-completions";

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

      const providerBaseUrl = shouldUseGatewayRoot(api, upstreamBaseUrl)
        ? gatewayRoot
        : baseUrl;

      // Referer and x-session-id are injected per-request via the
      // `before_provider_headers` hook registered in the extension entry
      // point, so provider registration only needs the gateway URL and API
      // path here.
      deps.registerProvider(providerName, {
        baseUrl: providerBaseUrl,
        apiKey: "-",
        api,
      });
    }
  }

  async checkMissingModels(
    deps: CheckDeps,
    providers?: ApertureProvider[],
  ): Promise<void> {
    const config = configLoader.getConfig();
    if (!config.proxy.enabled) return;

    const checkedProviderIds = config.proxy.upstreamProviders
      .filter((p) => p.shouldCheckGatewayModels)
      .map((p) => p.id);
    if (checkedProviderIds.length === 0) return;

    const gatewayUrl = resolveGatewayUrl(config);
    if (!gatewayUrl && !providers) return;

    let gatewayProviders = providers;
    if (!gatewayProviders) {
      // Gateway availability is transient. This is a best-effort, warning-only
      // check, so a network failure or gateway timeout must never propagate
      // (the caller fires-and-forgets this promise) and crash Pi.
      try {
        gatewayProviders = await new ApertureClient(
          gatewayUrl as string,
        ).providers();
      } catch {
        return;
      }
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
    const next = config.proxy.upstreamProviders.map((p) => p.id);
    return {
      next,
      unregister: this.getProvidersToUnregister(lastProxyProviders, next),
    };
  }
}
