import type { Api, Model } from "@earendil-works/pi-ai";
import type { ApertureProvider, ApertureProviderConfigInfo } from "./api/types";
import type {
  DedicatedProviderConfig,
  ProxiedProviderConfig,
} from "./shared/config/loader";

function normalizeProviderBaseUrl(url: string): string[] {
  const normalized = url.replace(/\/+$/, "");
  return [normalized, normalized.replace(/\/v1\/?$/, "")];
}

function isSameOrChildUrl(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}/`);
}

function hasMatchingBaseUrl(
  baseUrls: string[],
  apertureBaseUrls: Set<string>,
): boolean {
  const apertureUrls = [...apertureBaseUrls];
  return baseUrls.some((baseUrl) =>
    normalizeProviderBaseUrl(baseUrl).some((localUrl) =>
      apertureUrls.some((apertureUrl) =>
        isSameOrChildUrl(localUrl, apertureUrl),
      ),
    ),
  );
}

function collectLocalProviders(models: readonly Model<Api>[]) {
  return Array.from(
    models.reduce((providers, model) => {
      if (model.provider === "aperture") return providers;
      const baseUrls = providers.get(model.provider) ?? new Set<string>();
      if (model.baseUrl) baseUrls.add(model.baseUrl);
      providers.set(model.provider, baseUrls);
      return providers;
    }, new Map<string, Set<string>>()),
  )
    .map(([id, baseUrls]) => ({ id, baseUrls: [...baseUrls] }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * A Pi-provider-to-Aperture-provider mapping produced by
 * {@link mapProxyProviders}. The `id` is the Pi provider id (routing key);
 * `apertureProviderId` is the Aperture gateway provider id (used for the
 * gateway model check and display, never routing).
 */
export interface MappedProxyProvider {
  /** Pi provider id. */
  id: string;
  /** Aperture gateway provider id this Pi provider maps to. */
  apertureProviderId: string;
  /** Display name resolved from the Aperture gateway provider, if known. */
  name?: string;
  /** Local Pi base URLs for this provider (empty when stale/missing). */
  baseUrls: string[];
  /** Whether the gateway model check is enabled for this mapping. */
  shouldCheckGatewayModels: boolean;
  /**
   * `true` when this Pi provider would be included by automatic matching
   * (exact id or, for admins, base URL). `false` when the mapping exists
   * only because it is persisted in config (a manual mapping).
   */
  matchedAutomatically: boolean;
  /** `false` when the Pi provider id no longer exists in the local registry. */
  existsLocally: boolean;
}

/**
 * Build the proxy provider list by MERGING automatic matches with persisted
 * (manual) mappings.
 *
 * Automatic matching keeps a Pi provider when:
 * - its id equals an Aperture gateway provider id (works for non-admin grants
 *   too, since `/api/providers` is not admin-only), or
 * - one of its base URLs matches an Aperture provider base URL from
 *   `/aperture/config` (admin-only; non-admin grants get an empty config-info
 *   map after the 403 tolerance fix, so this strategy contributes nothing).
 *
 * Persisted entries from `existingProviders` are preserved even when they do
 * not auto-match — that is how manual mappings survive a settings submenu
 * reopen (the submenu rebuilds this list every time it opens). A persisted
 * `apertureProviderId` override is honored on auto-matched providers too, so
 * hand-edited overrides are not silently dropped.
 *
 * No fuzzy/broad matching is invented: a non-admin with mismatched ids gets a
 * mapping only if they explicitly add one, which lands it in
 * `existingProviders` and is then preserved here.
 */
export function mapProxyProviders(
  localModels: readonly Model<Api>[],
  providerInfos: Map<string, ApertureProviderConfigInfo>,
  gatewayProviders: ApertureProvider[],
  existingProviders: ProxiedProviderConfig[],
): MappedProxyProvider[] {
  const gatewayNames = new Map(
    gatewayProviders.map((provider) => [provider.id, provider.name]),
  );
  // Last-wins dedupe by Pi provider id, matching the merge semantics below.
  const existingByPiId = new Map(
    existingProviders.map((provider) => [provider.id, provider]),
  );
  const gatewayProviderIds = new Set([
    ...providerInfos.keys(),
    ...gatewayProviders.map((provider) => provider.id),
  ]);

  const localProviders = collectLocalProviders(localModels);
  const localById = new Map(
    localProviders.map((provider) => [provider.id, provider]),
  );

  const nameOf = (apertureProviderId: string): string | undefined =>
    gatewayNames.get(apertureProviderId) ??
    providerInfos.get(apertureProviderId)?.name;

  const result = new Map<string, MappedProxyProvider>();

  // 1. Automatic matches (exact id, then base URL for admins).
  for (const localProvider of localProviders) {
    let autoApertureProviderId: string | undefined;
    if (gatewayProviderIds.has(localProvider.id)) {
      autoApertureProviderId = localProvider.id;
    } else {
      for (const [gatewayProviderId, info] of providerInfos.entries()) {
        if (
          hasMatchingBaseUrl(
            localProvider.baseUrls,
            new Set(normalizeProviderBaseUrl(info.baseUrl)),
          )
        ) {
          autoApertureProviderId = gatewayProviderId;
          break;
        }
      }
    }
    if (!autoApertureProviderId) continue;

    const existing = existingByPiId.get(localProvider.id);
    // Honor a persisted apertureProviderId override so hand-edited overrides
    // are not silently dropped on the next submenu open.
    const apertureProviderId =
      existing?.apertureProviderId ?? autoApertureProviderId;

    result.set(localProvider.id, {
      id: localProvider.id,
      apertureProviderId,
      name: nameOf(apertureProviderId),
      baseUrls: localProvider.baseUrls,
      shouldCheckGatewayModels: existing?.shouldCheckGatewayModels ?? true,
      matchedAutomatically: true,
      existsLocally: true,
    });
  }

  // 2. Persisted/manual mappings that did not auto-match. Preserved so manual
  //    mappings survive settings reopens; flagged stale when the local Pi
  //    provider has disappeared.
  for (const existing of existingByPiId.values()) {
    if (result.has(existing.id)) continue;
    const apertureProviderId = existing.apertureProviderId ?? existing.id;
    const localProvider = localById.get(existing.id);
    result.set(existing.id, {
      id: existing.id,
      apertureProviderId,
      name: nameOf(apertureProviderId),
      baseUrls: localProvider?.baseUrls ?? [],
      shouldCheckGatewayModels: existing.shouldCheckGatewayModels ?? true,
      matchedAutomatically: false,
      existsLocally: Boolean(localProvider),
    });
  }

  return [...result.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function mapDedicatedProviders(
  gatewayProviders: ApertureProvider[],
  existingProviders: DedicatedProviderConfig[],
): DedicatedProviderConfig[] {
  const existing = new Map(
    existingProviders.map((provider) => [provider.id, provider]),
  );

  return gatewayProviders.map((provider) => ({
    id: provider.id,
    name: provider.name,
    enabled: existing.get(provider.id)?.enabled ?? true,
  }));
}
