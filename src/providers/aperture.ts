import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../config";
import { fetchApertureProviderModels } from "../lib/aperture-api";
import {
  clearProviderModelsCache,
  getProviderModelsCache,
  setProviderModelsCache,
} from "../state/provider-model-cache";
import { mergeModels, toModelConfig } from "./model-config";

/**
 * Preserve provenance similarly to pi-synthetic so downstream providers can
 * attribute traffic to Pi / this extension.
 */
const APERTURE_PROVENANCE_HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

/**
 * Providers for which we bootstrap models at startup (before first turn)
 * to make CLI model selection deterministic.
 */
const BOOTSTRAP_DISCOVERY_PROVIDERS = new Set(["openrouter"]);

/** Returns configured gateway URL without trailing slash. */
export function resolveGatewayUrl(): string | null {
  const { baseUrl, providers } = configLoader.getConfig();
  if (!baseUrl || providers.length === 0) return null;
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Returns the Aperture provider base URL used for provider registration.
 *
 * Aperture exposes multiple protocol paths (OpenAI, Anthropic, Gemini, ...).
 * For this extension we route through the OpenAI-compatible `/v1` surface that
 * Pi providers use (`openai-completions` API).
 */
export function resolveApertureProviderBaseUrl(): string | null {
  const gateway = resolveGatewayUrl();
  if (!gateway) return null;
  return `${gateway}/v1`;
}

function resolveProviderHeaders(
  models: ProviderModelConfig[],
): Record<string, string> {
  const modelHeaders = models.find((m) => m.headers)?.headers ?? {};
  return {
    ...APERTURE_PROVENANCE_HEADERS,
    ...modelHeaders,
  };
}

async function getOrLoadProviderModelsCache(
  gatewayUrl: string,
  providers: string[],
): Promise<Map<string, string[]>> {
  const current = getProviderModelsCache();
  if (current) return current;

  const loaded = await fetchApertureProviderModels(gatewayUrl, providers);
  setProviderModelsCache(loaded);
  return loaded;
}

export function resetApertureModelsCache(): void {
  clearProviderModelsCache();
}

/**
 * Apply Aperture override to configured providers:
 * - provider baseUrl -> aperture /v1 endpoint
 * - apiKey -> dummy token (Aperture injects real key server-side)
 * - headers -> provenance + provider/model headers
 */
export async function applyAperture(
  pi: ExtensionAPI,
  registry: ExtensionContext["modelRegistry"],
): Promise<string[]> {
  const baseUrl = resolveApertureProviderBaseUrl();
  const gatewayUrl = resolveGatewayUrl();
  if (!baseUrl || !gatewayUrl) return [];

  const { providers } = configLoader.getConfig();

  let modelCache: Map<string, string[]>;
  try {
    modelCache = await getOrLoadProviderModelsCache(gatewayUrl, providers);
  } catch {
    modelCache = new Map();
  }

  for (const provider of providers) {
    const existingModels = registry
      .getAll()
      .filter((m) => m.provider === provider) as ProviderModelConfig[];

    const models = mergeModels(existingModels, modelCache.get(provider));

    pi.registerProvider(provider, {
      baseUrl,
      apiKey: "-",
      headers: resolveProviderHeaders(models),
      ...(models.length > 0 && { api: models[0].api, models }),
    });
  }

  return providers;
}

/**
 * Pre-register selected providers from Aperture model discovery so CLI model
 * resolution works even when a model is not present in Pi built-ins.
 */
export async function bootstrapProvidersFromAperture(
  pi: ExtensionAPI,
): Promise<void> {
  const baseUrl = resolveApertureProviderBaseUrl();
  const gatewayUrl = resolveGatewayUrl();
  if (!baseUrl || !gatewayUrl) return;

  const { providers } = configLoader.getConfig();

  let modelCache: Map<string, string[]>;
  try {
    modelCache = await fetchApertureProviderModels(gatewayUrl, providers);
    setProviderModelsCache(modelCache);
  } catch {
    return;
  }

  for (const provider of providers) {
    if (!BOOTSTRAP_DISCOVERY_PROVIDERS.has(provider)) continue;

    const modelIds = modelCache.get(provider) ?? [];
    if (modelIds.length === 0) continue;

    const models = modelIds.map((id) => toModelConfig(id));

    pi.registerProvider(provider, {
      baseUrl,
      apiKey: "-",
      api: "openai-completions",
      headers: resolveProviderHeaders(models),
      models,
    });
  }
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
