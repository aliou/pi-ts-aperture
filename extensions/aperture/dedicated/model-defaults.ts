import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { ApertureModelPricing } from "../../../src/api/types";

export interface ApertureModelDefaultsInput {
  id: string;
  providerId: string;
  provider?: {
    id: string;
    name?: string;
  };
  pricing?: ApertureModelPricing;
}

const TOKENS_PER_MILLION = 1_000_000;

function parsePrice(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n * TOKENS_PER_MILLION : 0;
}

export function buildDefaultModelConfig(
  model: ApertureModelDefaultsInput,
): ProviderModelConfig {
  const id = model.id;
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
