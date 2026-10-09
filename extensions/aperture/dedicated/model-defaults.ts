import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type {
  ApertureModelLimits,
  ApertureModelPricing,
} from "../../../src/api/types";
import type { ModelMetadata } from "../../../src/model-metadata";

export interface ApertureModelDefaultsInput {
  id: string;
  name?: string;
  providerId: string;
  provider?: {
    id: string;
    name?: string;
  };
  pricing?: ApertureModelPricing;
  /** Token limits the gateway advertises for this model on this route. */
  limits?: ApertureModelLimits;
  /** Resolved capability metadata (Pi registry / models.dev). */
  metadata?: ModelMetadata;
}

/** Non-positive limits mean "not reported". */
function reportedLimit(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}

const TOKENS_PER_MILLION = 1_000_000;

function parsePrice(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n * TOKENS_PER_MILLION : 0;
}

/**
 * Merge gateway pricing field-by-field over the metadata cost. Every rate the
 * gateway reports wins; rates it omits keep the registry/models.dev value.
 * A partial pricing response (e.g. only cache rates) must not zero out the
 * other fields or be discarded entirely.
 */
function mergeCost(
  pricing: ApertureModelPricing | undefined,
  base: ProviderModelConfig["cost"] | undefined,
): ProviderModelConfig["cost"] {
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

/**
 * Build a model config from safe defaults, resolved metadata, and the gateway's
 * own numbers. Precedence: defaults < metadata (models.dev < Pi registry,
 * merged upstream by the resolver) < gateway (cost, and the token limits it
 * advertises for the route).
 *
 * Gateway limits win because they describe the endpoint Pi actually calls: a
 * catalog entry names the model's native capacity, while the route may cap it
 * lower, and an over-reported limit is a rejected request rather than a
 * slightly early compaction.
 */
export function buildDefaultModelConfig(
  model: ApertureModelDefaultsInput,
): ProviderModelConfig {
  const id = model.id;
  const metadata = model.metadata;
  const cost = mergeCost(model.pricing, metadata?.cost);
  const contextWindow =
    reportedLimit(model.limits?.context_window_tokens) ??
    metadata?.contextWindow ??
    128_000;
  const maxTokens =
    reportedLimit(model.limits?.max_output_tokens) ??
    metadata?.maxTokens ??
    8_192;

  return {
    id,
    name: metadata?.name ?? model.name ?? id,
    reasoning: metadata?.reasoning ?? false,
    ...(metadata?.thinkingLevelMap
      ? { thinkingLevelMap: metadata.thinkingLevelMap }
      : {}),
    input: metadata?.input ?? ["text"],
    cost,
    contextWindow,
    maxTokens,
    ...(metadata?.compat ? { compat: metadata.compat } : {}),
  };
}
