import type {
  ExtensionAPI,
  ExtensionContext,
  ProviderModelConfig,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../config";
import { fetchGatewayModelIds } from "../lib/health";

/**
 * Preserve provenance similarly to pi-synthetic so downstream providers can
 * attribute traffic to Pi / this extension.
 */
const APERTURE_PROVENANCE_HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

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
): Promise<{ providers: string[]; missingModels: string[] }> {
  const baseUrl = resolveApertureProviderBaseUrl();
  if (!baseUrl) return { providers: [], missingModels: [] };

  const { providers } = configLoader.getConfig();

  for (const provider of providers) {
    const existingModels = registry
      .getAll()
      .filter((m) => m.provider === provider) as ProviderModelConfig[];

    if (existingModels.length === 0) continue;

    pi.registerProvider(provider, {
      baseUrl,
      apiKey: "-",
      headers: resolveProviderHeaders(existingModels),
      api: existingModels[0].api,
      models: existingModels,
    });
  }

  const gatewayUrl = resolveGatewayUrl();
  const gatewayModelIds = gatewayUrl
    ? await fetchGatewayModelIds(gatewayUrl)
    : [];

  let missingModels: string[] = [];
  if (gatewayModelIds.length > 0) {
    const routedModelIds = registry
      .getAll()
      .filter((m) => providers.includes(m.provider))
      .map((m) => m.id);
    missingModels = routedModelIds.filter(
      (id) => !gatewayModelIds.includes(id),
    );
  }

  return { providers, missingModels };
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
