/**
 * Core decision logic -- all pure functions.
 */

import type {
  ApertureConfig,
  Api,
  ApplyPlan,
  ConfigChangePlan,
  GatewayModelInfo,
  Model,
  ProviderRegistration,
} from "./types";
import { APERTURE_PROVIDER_NAME } from "./types";

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
  models: Model<Api>[],
): Record<string, string> {
  const modelHeaders = models.find((m) => m.headers)?.headers ?? {};
  return {
    ...APERTURE_PROVENANCE_HEADERS,
    ...modelHeaders,
  };
}

/**
 * Builds a plan for applying Aperture in override mode.
 *
 * Groups registry models by configured provider, builds registrations,
 * and computes missing models (if gateway model IDs are provided).
 *
 * Providers with no models in the registry are skipped (nothing to reroute).
 */
export function buildApplyPlan(
  config: ApertureConfig,
  registryModels: Model<Api>[],
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
 * Build a single provider registration for Aperture-as-provider mode.
 *
 * Every field on the returned `Model` objects comes from the gateway's
 * `/v1/models` response (with the provenance/name defaults this extension
 * controls). Fields the gateway stays silent about are left unset --
 * downstream Pi code handles missing metadata gracefully.
 *
 * Returns null when the gateway returned no models; the caller should skip
 * registration (and optionally unregister an existing "aperture" provider).
 */
export function buildApertureProviderPlan(
  providerBaseUrl: string,
  gatewayModels: GatewayModelInfo[],
): ProviderRegistration | null {
  if (gatewayModels.length === 0) return null;

  const models: Model<Api>[] = gatewayModels.map((gm) => {
    // Model<Api> fields are intentionally loose here -- we pass through only
    // the gateway-provided data, leaving everything else unset. We build into
    // a Record so TypeScript doesn't try to validate the partial shape.
    const m: Record<string, unknown> = {
      id: gm.id,
      name: gm.name ?? gm.id,
      provider: APERTURE_PROVIDER_NAME,
    };
    if (gm.contextWindow !== undefined) m.contextWindow = gm.contextWindow;
    if (gm.maxTokens !== undefined) m.maxTokens = gm.maxTokens;
    if (gm.input !== undefined) m.input = gm.input;
    if (gm.reasoning !== undefined) m.reasoning = gm.reasoning;
    if (gm.cost !== undefined) m.cost = gm.cost;
    if (gm.api !== undefined) m.api = gm.api;
    return m as unknown as Model<Api>;
  });

  return {
    provider: APERTURE_PROVIDER_NAME,
    baseUrl: providerBaseUrl,
    apiKey: "-",
    headers: { ...APERTURE_PROVENANCE_HEADERS },
    api: "openai-completions",
    models,
  };
}

/**
 * Snapshot of Aperture-owned provider registrations at a given point in
 * time. Used by `planConfigChange` to decide which providers to unregister
 * and whether the currently active model should be refreshed after a
 * config change.
 */
export interface ApertureRegistrationState {
  mode: "override" | "provider";
  /** For override mode: list of providers routed. Empty in provider mode. */
  providers: string[];
}

/**
 * Returns the set of provider names currently registered / about to be
 * registered by this extension, given its mode. In override mode that's
 * whatever the user routes; in provider mode it's just "aperture".
 */
function registeredProviders(state: ApertureRegistrationState): string[] {
  return state.mode === "override" ? state.providers : [APERTURE_PROVIDER_NAME];
}

/**
 * Plans the effects of a configuration change.
 *
 * Computes:
 * - providers to unregister (were owned by aperture before but aren't now)
 * - whether to re-resolve the current model (its provider is still ours)
 */
export function planConfigChange(
  prev: ApertureRegistrationState,
  next: ApertureRegistrationState,
  activeModelProvider?: string,
): ConfigChangePlan {
  const prevSet = new Set(registeredProviders(prev));
  const nextSet = new Set(registeredProviders(next));

  const removedProviders = [...prevSet].filter((p) => !nextSet.has(p));

  const shouldRefreshModel =
    activeModelProvider !== undefined && nextSet.has(activeModelProvider);

  return { removedProviders, shouldRefreshModel };
}
