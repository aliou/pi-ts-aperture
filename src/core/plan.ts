/**
 * Core decision logic -- all pure functions.
 */

import type {
  ApertureConfig,
  ApplyPlan,
  ConfigChangePlan,
  ModelInfo,
  ProviderRegistration,
} from "./types";

/**
 * Preserve provenance similarly to pi-synthetic so downstream providers can
 * attribute traffic to Pi / this extension.
 */
export const APERTURE_PROVENANCE_HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

/**
 * Resolves headers for a provider registration.
 * Merges provenance headers with the first model's headers (if any).
 */
export function resolveProviderHeaders(
  models: ModelInfo[],
): Record<string, string> {
  const modelHeaders = models.find((m) => m.headers)?.headers ?? {};
  return {
    ...APERTURE_PROVENANCE_HEADERS,
    ...modelHeaders,
  };
}

/**
 * Builds a plan for applying Aperture configuration.
 *
 * Groups registry models by configured provider, builds registrations,
 * and computes missing models (if gateway model IDs are provided).
 *
 * Providers with no models in the registry are skipped (nothing to reroute).
 */
export function buildApplyPlan(
  config: ApertureConfig,
  registryModels: ModelInfo[],
  providerBaseUrl: string,
  gatewayModelIds: string[],
): ApplyPlan {
  const { providers } = config;

  const registrations: ProviderRegistration[] = [];

  for (const provider of providers) {
    const existingModels = registryModels.filter(
      (m) => m.provider === provider,
    );

    if (existingModels.length === 0) continue;

    registrations.push({
      provider,
      baseUrl: providerBaseUrl,
      apiKey: "-",
      headers: resolveProviderHeaders(existingModels),
      api: existingModels[0].api ?? "openai-completions",
      models: existingModels,
    });
  }

  let missingModels: string[] = [];
  if (gatewayModelIds.length > 0) {
    const routedModelIds = registryModels
      .filter((m) => providers.includes(m.provider))
      .map((m) => m.id);
    missingModels = routedModelIds.filter(
      (id) => !gatewayModelIds.includes(id),
    );
  }

  return { registrations, missingModels };
}

/**
 * Plans the effects of a configuration change.
 *
 * @param prevProviders - Providers that were previously configured
 * @param nextProviders - Providers that are now configured
 * @param activeModelProvider - Provider of the currently active model (if any)
 * @returns ConfigChangePlan with removed providers and refresh decision
 */
export function planConfigChange(
  prevProviders: string[],
  nextProviders: string[],
  activeModelProvider?: string,
): ConfigChangePlan {
  const removedProviders = prevProviders.filter(
    (provider) => !nextProviders.includes(provider),
  );

  const shouldRefreshModel =
    activeModelProvider !== undefined &&
    nextProviders.includes(activeModelProvider);

  return { removedProviders, shouldRefreshModel };
}
