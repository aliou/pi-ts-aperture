import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";
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
