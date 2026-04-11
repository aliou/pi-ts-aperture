import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../config";
import {
  APERTURE_PROVIDER_NAME,
  buildApertureProviderPlan,
  buildApplyPlan,
  resolveGatewayUrl,
  resolveProviderBaseUrl,
} from "../core";
import { fetchGatewayModelIds, fetchGatewayModels } from "../lib/health";

export { resolveGatewayUrl } from "../core";

/**
 * Result of applying Aperture to the provider registry. `providers` is the
 * list of provider names this extension now owns (i.e. provider mode always
 * returns `["aperture"]`, override mode returns the configured list).
 */
export interface ApplyResult {
  mode: "override" | "provider";
  providers: string[];
  gatewayUrl: string | null;
}

/**
 * Apply Aperture in provider mode: register a single provider named
 * "aperture" with models fetched from GET <gateway>/v1/models. No model
 * registry is required -- the gateway is the sole source of truth.
 *
 * Returns the apply result. When the gateway is unreachable or returns no
 * models, any previously-registered "aperture" provider is unregistered.
 */
export async function applyApertureProvider(
  pi: ExtensionAPI,
): Promise<ApplyResult> {
  const config = configLoader.getConfig();
  const baseUrl = resolveProviderBaseUrl(config);
  const gatewayUrl = resolveGatewayUrl(config);
  if (!baseUrl) {
    return { mode: "provider", providers: [], gatewayUrl: null };
  }

  const gatewayModels = await fetchGatewayModels(gatewayUrl as string);
  const registration = buildApertureProviderPlan(baseUrl, gatewayModels);

  if (!registration) {
    pi.unregisterProvider(APERTURE_PROVIDER_NAME);
    return { mode: "provider", providers: [], gatewayUrl };
  }

  pi.registerProvider(registration.provider, {
    baseUrl: registration.baseUrl,
    apiKey: registration.apiKey,
    headers: registration.headers,
    api: registration.api,
    models: registration.models,
  });

  return {
    mode: "provider",
    providers: [APERTURE_PROVIDER_NAME],
    gatewayUrl,
  };
}

/**
 * Apply Aperture to the provider registry based on current config.
 *
 * In "override" mode: patches baseUrl, apiKey, and headers on existing
 * providers. Models are left exactly as registered by Pi built-ins or other
 * extensions -- Aperture never touches model definitions.
 *
 * In "provider" mode: delegates to {@link applyApertureProvider}. The
 * `registry` argument is accepted for API uniformity but is not consulted.
 */
export async function applyAperture(
  pi: ExtensionAPI,
  registry: ExtensionContext["modelRegistry"],
): Promise<ApplyResult> {
  const config = configLoader.getConfig();

  if (config.mode === "provider") {
    return applyApertureProvider(pi);
  }

  // Override mode.
  const baseUrl = resolveProviderBaseUrl(config);
  const gatewayUrl = resolveGatewayUrl(config);
  if (!baseUrl) {
    return { mode: "override", providers: [], gatewayUrl: null };
  }
  if (config.providers.length === 0) {
    return { mode: "override", providers: [], gatewayUrl };
  }

  const registryModels = registry.getAll();
  const plan = buildApplyPlan(config, registryModels, baseUrl, []);

  for (const reg of plan.registrations) {
    pi.registerProvider(reg.provider, {
      baseUrl: reg.baseUrl,
      apiKey: reg.apiKey,
      headers: reg.headers,
      api: reg.api,
      models: reg.models,
    });
  }

  return { mode: "override", providers: config.providers, gatewayUrl };
}

/**
 * Fetch gateway models and return missing ones relative to the override plan.
 *
 * Only meaningful in override mode -- in provider mode every model by
 * definition comes from the gateway, so there is no notion of "missing".
 */
export async function checkGatewayModels(
  gatewayUrl: string,
  registry: ExtensionContext["modelRegistry"],
): Promise<{ missingModels: string[] }> {
  const config = configLoader.getConfig();
  if (config.mode !== "override") return { missingModels: [] };

  const baseUrl = resolveProviderBaseUrl(config);
  if (!baseUrl) return { missingModels: [] };

  const gatewayModelIds = await fetchGatewayModelIds(gatewayUrl);
  const registryModels = registry.getAll();
  const plan = buildApplyPlan(config, registryModels, baseUrl, gatewayModelIds);
  return { missingModels: plan.missingModels };
}

/** Re-resolve and set current model after provider registry updates. */
export async function refreshActiveModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
): Promise<boolean> {
  if (!ctx.model) return false;

  const updated = ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
  if (!updated) return false;

  return pi.setModel(updated);
}
