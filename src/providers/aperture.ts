import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../config";
import {
  buildApplyPlan,
  resolveGatewayUrl,
  resolveProviderBaseUrl,
} from "../core";
import { fetchGatewayModelIds } from "../lib/health";

export { resolveGatewayUrl } from "../core";

/**
 * Apply Aperture override to configured providers.
 *
 * Only patches baseUrl, apiKey, and headers. Models are left exactly as
 * registered by Pi built-ins or other extensions -- Aperture never touches
 * model definitions.
 *
 * Providers with no models in the registry are skipped (nothing to reroute).
 */
export async function applyAperture(
  pi: ExtensionAPI,
  registry: ExtensionContext["modelRegistry"],
): Promise<{ providers: string[]; gatewayUrl: string | null }> {
  const config = configLoader.getConfig();
  const baseUrl = resolveProviderBaseUrl(config);
  if (!baseUrl) return { providers: [], gatewayUrl: null };

  const gatewayUrl = resolveGatewayUrl(config);

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

  return { providers: config.providers, gatewayUrl };
}

/**
 * Fetch gateway models and return missing ones relative to the plan.
 */
export async function checkGatewayModels(
  gatewayUrl: string,
  registry: ExtensionContext["modelRegistry"],
): Promise<{ missingModels: string[] }> {
  const config = configLoader.getConfig();
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
