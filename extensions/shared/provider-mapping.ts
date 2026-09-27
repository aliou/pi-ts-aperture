import type { Api, Model } from "@earendil-works/pi-ai";
import type { ApertureProvider } from "../../src/api/types";
import type {
  DedicatedProviderConfig,
  ProxiedProviderConfig,
} from "./config/types";

/** List local providers, using exact gateway id matches only as defaults. */
export function mapProxyProviders(
  localModels: readonly Model<Api>[],
  gatewayProviders: ApertureProvider[],
  existingProviders: ProxiedProviderConfig[],
) {
  const names = new Map(
    gatewayProviders.map((provider) => [provider.id, provider.name]),
  );
  const gatewayProviderIds = new Set(gatewayProviders.map((p) => p.id));
  const existing = new Map(
    existingProviders.map((provider) => [provider.id, provider]),
  );

  return Array.from(
    localModels.reduce((providers, model) => {
      if (model.provider === "aperture") return providers;
      providers.add(model.provider);
      return providers;
    }, new Set<string>()),
  )
    .sort((a, b) => a.localeCompare(b))
    .map((id) => {
      const existingEntry = existing.get(id);
      const gatewayId =
        existingEntry?.gatewayId ??
        (gatewayProviderIds.has(id) ? id : undefined);
      return {
        id,
        gatewayId,
        routed: existingEntry?.enabled ?? existingEntry !== undefined,
        name: gatewayId ? names.get(gatewayId) : undefined,
        enabled: existingEntry?.enabled ?? existingEntry !== undefined,
        shouldCheckGatewayModels:
          existingEntry?.shouldCheckGatewayModels ?? true,
        keepGatewayModelsOnly: existingEntry?.keepGatewayModelsOnly ?? false,
        api: existingEntry?.api,
      };
    });
}

/** One row per gateway target, regardless of how many local providers exist. */
export function mapGatewayProxyProviders(
  localModels: readonly Model<Api>[],
  gatewayProviders: ApertureProvider[],
  existingProviders: ProxiedProviderConfig[],
) {
  const localIds = new Set(localModels.map((model) => model.provider));
  return gatewayProviders
    .filter((provider) => provider.id !== "aperture")
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id))
    .map((provider) => ({
      provider,
      pairedLocalIds: existingProviders
        .filter((entry) => entry.gatewayId === provider.id)
        .map((entry) => entry.id),
      exactLocalId: localIds.has(provider.id) ? provider.id : undefined,
    }));
}

export function mapDedicatedProviders(
  gatewayProviders: ApertureProvider[],
  existingProviders: DedicatedProviderConfig[],
): DedicatedProviderConfig[] {
  const existing = new Map(
    existingProviders.map((provider) => [provider.id, provider]),
  );

  return gatewayProviders
    .filter((provider) => !provider.requires_client_auth)
    .map((provider) => ({
      id: provider.id,
      name: provider.name,
      enabled: existing.get(provider.id)?.enabled ?? true,
      api: existing.get(provider.id)?.api,
    }));
}
