import type { Api, Model } from "@earendil-works/pi-ai";
import type { ApertureModelPricing } from "../api/types";
import type { ModelMetadata } from "../model-metadata";

export interface ApertureModelDefaultsInput {
  id: string;
  name?: string;
  pricing?: ApertureModelPricing;
  metadata?: ModelMetadata;
}

type ApertureModelDefaults = Omit<Model<Api>, "api" | "provider" | "baseUrl">;

const TOKENS_PER_MILLION = 1_000_000;

function parsePrice(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n * TOKENS_PER_MILLION : 0;
}

function mergeCost(
  pricing: ApertureModelPricing | undefined,
  base: ApertureModelDefaults["cost"] | undefined,
): ApertureModelDefaults["cost"] {
  const cost = base ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  if (!pricing) return cost;
  return {
    ...cost,
    ...(pricing.input ? { input: parsePrice(pricing.input) } : {}),
    ...(pricing.output ? { output: parsePrice(pricing.output) } : {}),
    ...(pricing.input_cache_read
      ? { cacheRead: parsePrice(pricing.input_cache_read) }
      : {}),
    ...(pricing.input_cache_write
      ? { cacheWrite: parsePrice(pricing.input_cache_write) }
      : {}),
  };
}

export function buildDefaultModelConfig(
  model: ApertureModelDefaultsInput,
): ApertureModelDefaults {
  const id = model.id;
  const metadata = model.metadata;
  const cost = mergeCost(model.pricing, metadata?.cost);

  return {
    id,
    name: metadata?.name ?? model.name ?? id,
    reasoning: metadata?.reasoning ?? false,
    ...(metadata?.thinkingLevelMap
      ? { thinkingLevelMap: metadata.thinkingLevelMap }
      : {}),
    input: metadata?.input ?? ["text"],
    cost,
    contextWindow: metadata?.contextWindow ?? 128_000,
    maxTokens: metadata?.maxTokens ?? 8_192,
    ...(metadata?.compat ? { compat: metadata.compat } : {}),
  };
}
