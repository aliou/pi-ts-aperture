import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { CachedModel } from "./config";
import type { GatewayModel } from "./gateway";

/** Separator between provider ID and gateway model ID in Pi model registry. */
export const PROVIDER_SEPARATOR = "::";

/** Parse a pricing string (per-token USD) to a number. */
function parsePrice(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function buildDefaultModelConfig(
  model: GatewayModel,
): ProviderModelConfig {
  const id = model.provider
    ? `${model.provider.id}${PROVIDER_SEPARATOR}${model.id}`
    : model.id;
  const cost = model.pricing
    ? {
        input: parsePrice(model.pricing.input),
        output: parsePrice(model.pricing.output),
        cacheRead: parsePrice(model.pricing.input_cache_read),
        cacheWrite: parsePrice(model.pricing.input_cache_write),
      }
    : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost,
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

/** Build a ProviderModelConfig from a cached model (no network call). */
export function buildCachedModelConfig(
  cached: CachedModel,
): ProviderModelConfig {
  const id = cached.providerId
    ? `${cached.providerId}${PROVIDER_SEPARATOR}${cached.id}`
    : cached.id;
  const cost = cached.pricing
    ? {
        input: parsePrice(cached.pricing.input),
        output: parsePrice(cached.pricing.output),
        cacheRead: parsePrice(cached.pricing.input_cache_read),
        cacheWrite: parsePrice(cached.pricing.input_cache_write),
      }
    : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost,
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

/** Check if a model config is still using default capabilities.
 * Used to warn the user that they should update models.json.
 */
export function isDefaultModelConfig(m: ProviderModelConfig): boolean {
  return (
    m.contextWindow === 128_000 &&
    m.maxTokens === 8_192 &&
    m.reasoning === false
  );
}

/** Convert a GatewayModel to a CachedModel for persistence. */
export function toCachedModel(model: GatewayModel): CachedModel {
  return {
    id: model.id,
    providerId: model.providerId,
    providerName: model.provider?.name,
    pricing: model.pricing
      ? {
          input: model.pricing.input,
          input_cache_read: model.pricing.input_cache_read,
          input_cache_write: model.pricing.input_cache_write,
          output: model.pricing.output,
        }
      : undefined,
  };
}
