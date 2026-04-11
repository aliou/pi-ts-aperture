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
 * Safe defaults used for required `Model<Api>` fields when the gateway does
 * not emit them.
 *
 * Pi's `Model<TApi>` interface (see `@mariozechner/pi-ai`) makes every field
 * non-optional -- we have to populate them. We deliberately do not consult
 * pi-ai's built-in catalogue or any other provider's metadata; the gateway
 * is the sole source of truth. These defaults are picked to keep the
 * extension usable when the gateway omits metadata:
 *
 * - `contextWindow: 200_000` -- generous enough for a modern mid/large model;
 *   will not cause Pi's prompt manager to immediately refuse a prompt.
 * - `maxTokens: 8192` -- safe output cap that matches most production models.
 * - `cost: { 0, 0, 0, 0 }` -- honest ($0 per million) when the gateway does
 *   not advertise pricing. Users on Aperture are typically billed centrally
 *   so $0 client-side is not misleading.
 * - `reasoning: false`, `input: ["text"]`, `api: "openai-completions"` --
 *   minimal, least-surprising defaults.
 */
export const APERTURE_MODEL_DEFAULTS = {
  contextWindow: 200_000,
  maxTokens: 8192,
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  api: "openai-completions" as Api,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as const;

/**
 * Clamp an arbitrary list of strings down to the `("text" | "image")[]`
 * literal shape required by `Model.input`. Unknown modalities are dropped.
 * Falls back to `["text"]` if the filter produces an empty list.
 */
function sanitizeInputModalities(
  raw: string[] | undefined,
): ("text" | "image")[] {
  if (!raw) return [...APERTURE_MODEL_DEFAULTS.input];
  const filtered = raw.filter(
    (s): s is "text" | "image" => s === "text" || s === "image",
  );
  return filtered.length > 0 ? filtered : [...APERTURE_MODEL_DEFAULTS.input];
}

/**
 * Build a single provider registration for Aperture-as-provider mode.
 *
 * Every field on the returned `Model<Api>` objects comes from the gateway's
 * `/v1/models` response where the gateway emits it, and from
 * `APERTURE_MODEL_DEFAULTS` otherwise. We do not cross-reference pi-ai's
 * catalogue or any other provider's models.
 *
 * Wire-only pricing fields that the gateway emits but that have no slot in
 * Pi's `Model.cost` shape -- `image`, `web_search`, `internal_reasoning` --
 * are dropped at the health-lib parser. There is intentionally nowhere in
 * `Model<TApi>` to put them (see `@mariozechner/pi-ai/dist/types.d.ts`:
 * `cost: { input, output, cacheRead, cacheWrite }` is strictly typed, and
 * `Usage` / `calculateCost` only track those four dimensions).
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
    const cost = {
      input: gm.cost?.input ?? APERTURE_MODEL_DEFAULTS.cost.input,
      output: gm.cost?.output ?? APERTURE_MODEL_DEFAULTS.cost.output,
      cacheRead: gm.cost?.cacheRead ?? APERTURE_MODEL_DEFAULTS.cost.cacheRead,
      cacheWrite:
        gm.cost?.cacheWrite ?? APERTURE_MODEL_DEFAULTS.cost.cacheWrite,
    };

    return {
      id: gm.id,
      name: gm.name ?? gm.id,
      api: (gm.api as Api | undefined) ?? APERTURE_MODEL_DEFAULTS.api,
      provider: APERTURE_PROVIDER_NAME,
      baseUrl: providerBaseUrl,
      reasoning: gm.reasoning ?? APERTURE_MODEL_DEFAULTS.reasoning,
      input: sanitizeInputModalities(gm.input),
      cost,
      contextWindow: gm.contextWindow ?? APERTURE_MODEL_DEFAULTS.contextWindow,
      maxTokens: gm.maxTokens ?? APERTURE_MODEL_DEFAULTS.maxTokens,
    };
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
