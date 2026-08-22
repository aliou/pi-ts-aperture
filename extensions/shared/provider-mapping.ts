import type { Api, Model } from "@earendil-works/pi-ai";
import type { ApertureProvider } from "../../src/api/types";
import type {
  DedicatedProviderConfig,
  ProxiedProviderConfig,
} from "./config/types";

/**
 * Match local Pi providers against Aperture gateway providers.
 *
 * The `/api/providers` endpoint already filters providers by grant scope
 * (enabled/disabled, role grants), so we match exclusively by provider id
 * against what the gateway exposes. No base-URL matching is performed; the
 * admin-only `/aperture/config` endpoint and its base URLs are no longer
 * consulted here.
 */
export function mapProxyProviders(
  localModels: readonly Model<Api>[],
  gatewayProviders: ApertureProvider[],
  existingProviders: ProxiedProviderConfig[],
) {
  const names = new Map(
    gatewayProviders.map((provider) => [provider.id, provider.name]),
  );
  const gatewayProviderIds = new Set(
    gatewayProviders.map((provider) => provider.id),
  );
  const existing = new Map(
    existingProviders.map((provider) => [provider.id, provider]),
  );

  return Array.from(
    localModels.reduce((providers, model) => {
      if (model.provider === "aperture") return providers;
      if (!gatewayProviderIds.has(model.provider)) return providers;
      providers.add(model.provider);
      return providers;
    }, new Set<string>()),
  )
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({
      id,
      name: names.get(id),
      shouldCheckGatewayModels:
        existing.get(id)?.shouldCheckGatewayModels ?? true,
    }));
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
