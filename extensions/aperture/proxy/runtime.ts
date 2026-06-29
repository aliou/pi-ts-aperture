import { getApiProvider } from "@earendil-works/pi-ai";
import { ApertureClient } from "../../../src/api/client";
import type { ApertureProvider } from "../../../src/api/types";
import { configLoader } from "../../../src/shared/config/loader";
import type { ResolvedConfig } from "../../../src/shared/config/types";
import type {
  Api,
  AssistantMessageEventStream,
  CheckDeps,
  Context,
  Model,
  SimpleStreamOptions,
  SyncDeps,
} from "../../../src/shared/types";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../../src/url";

const APERTURE_PROVENANCE_HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

const MAX_MISSING_MODELS_PER_PROVIDER = 5;

const ROOT_BASE_URL_APIS = new Set<Api>([
  // Pi's Codex adapter appends /codex/responses itself. Registering /v1
  // would produce /v1/codex/responses, which Aperture does not expose.
  "openai-codex-responses",
]);

export function shouldUseGatewayRootForProxy(api: Api): boolean {
  return ROOT_BASE_URL_APIS.has(api);
}

function resolveProviderHeaders(
  models: Model<Api>[],
  sessionId: string,
): Record<string, string> {
  const modelHeaders = models.find((m) => m.headers)?.headers ?? {};
  return {
    ...APERTURE_PROVENANCE_HEADERS,
    ...modelHeaders,
    "x-session-id": sessionId,
  };
}

export class ApertureRuntime {
  async sync(deps: SyncDeps): Promise<void> {
    const config = configLoader.getConfig();
    if (!config.proxy.enabled) return;
    if (!config.baseUrl || config.proxy.upstreamProviders.length === 0) return;

    const baseUrl = resolveProviderBaseUrl(config);
    if (!baseUrl) return;

    const allModels = deps.getModels();
    const providerIds = config.proxy.upstreamProviders
      .map((p) => p.id)
      .filter((id) => id !== "aperture");

    for (const providerName of providerIds) {
      const providerModels = allModels.filter(
        (m) => m.provider === providerName,
      );
      if (providerModels.length === 0) continue;

      const api = providerModels[0].api ?? "openai-completions";
      const builtIn = getApiProvider(api);

      const providerBaseUrl = shouldUseGatewayRootForProxy(api)
        ? resolveGatewayUrl(config)
        : baseUrl;
      if (!providerBaseUrl) continue;

      deps.registerProvider(providerName, {
        baseUrl: providerBaseUrl,
        apiKey: "-",
        headers: resolveProviderHeaders(providerModels, deps.getSessionId()),
        api,
        streamSimple: builtIn
          ? (
              model: Model<Api>,
              context: Context,
              options?: SimpleStreamOptions,
            ): AssistantMessageEventStream => {
              return builtIn.streamSimple(model, context, {
                ...options,
                headers: {
                  ...options?.headers,
                  "x-session-id": options?.sessionId ?? "",
                },
              });
            }
          : undefined,
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

    const gatewayProviders =
      providers ?? (await new ApertureClient(gatewayUrl as string).providers());
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
