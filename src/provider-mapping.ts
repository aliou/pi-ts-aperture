import type { Api, Model } from "@earendil-works/pi-ai";
import type { DedicatedProviderConfig } from "../extensions/aperture/shared/config/loader";
import type { ApertureProvider, ApertureProviderConfigInfo } from "./api/types";

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

export function mapProxyProviders(
  localModels: readonly Model<Api>[],
  providerInfos: Map<string, ApertureProviderConfigInfo>,
  gatewayProviders: ApertureProvider[],
  existingProviders: { id: string; shouldCheckGatewayModels?: boolean }[],
) {
  const names = new Map(
    gatewayProviders.map((provider) => [provider.id, provider.name]),
  );
  const apertureBaseUrls = new Set(
    [...providerInfos.values()].flatMap((provider) =>
      normalizeProviderBaseUrl(provider.baseUrl),
    ),
  );
  const existing = new Map(
    existingProviders.map((provider) => [provider.id, provider]),
  );
  const gatewayProviderIds = new Set([
    ...providerInfos.keys(),
    ...gatewayProviders.map((provider) => provider.id),
  ]);

  return collectLocalProviders(localModels)
    .filter(
      (provider) =>
        hasMatchingBaseUrl(provider.baseUrls, apertureBaseUrls) ||
        gatewayProviderIds.has(provider.id),
    )
    .map((provider) => ({
      ...provider,
      name: names.get(provider.id) ?? providerInfos.get(provider.id)?.name,
      shouldCheckGatewayModels:
        existing.get(provider.id)?.shouldCheckGatewayModels ?? true,
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
