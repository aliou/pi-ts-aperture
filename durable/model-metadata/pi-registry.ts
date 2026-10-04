/**
 * Pi native model registry source: per-model metadata extraction from
 * `Model<Api>` entries supplied by the caller.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelMetadata } from "./types";

function hasCost(cost: Model<Api>["cost"] | undefined): boolean {
  return cost !== undefined && (cost.input !== 0 || cost.output !== 0);
}

/**
 * Compat fields that are intrinsic to a model rather than to the provider
 * serving it. `supportsDeveloperRole` is a property of the model's training
 * (GLM/Kimi/DeepSeek reject developer messages whoever fronts them), and
 * `maxTokensField` tracks the model family's parameter naming. These survive
 * a cross-provider model-id match and are safe to copy.
 *
 * The rest (`supportsStore`, `supportsLongCacheRetention`,
 * `deferredToolsMode`, `zaiToolStream`, provider-named `thinkingFormat`, ...)
 * is endpoint-specific and stays out of a fallback match.
 */
const INTRINSIC_COMPAT_KEYS = [
  "supportsDeveloperRole",
  "maxTokensField",
  "requiresReasoningContentOnAssistantMessages",
] as const;

interface RegistryMatch {
  model: Model<Api>;
  providerExact: boolean;
}

function findRegistryMatch(
  registryModels: readonly Model<Api>[],
  providerId: string,
  modelId: string,
): RegistryMatch | null {
  const exact = registryModels.find(
    (m) => m.provider === providerId && m.id === modelId,
  );
  if (exact) return { model: exact, providerExact: true };
  const byId = registryModels.find((m) => m.id === modelId);
  return byId ? { model: byId, providerExact: false } : null;
}

/**
 * Apply Pi registry metadata for one gateway model onto `metadata`. A
 * provider-exact match copies everything including cost and `compat`; a
 * model-id fallback match copies capabilities only (cost and endpoint
 * quirks are provider-specific). No match leaves `metadata` untouched.
 */
export function applyRegistryMetadata(
  metadata: ModelMetadata,
  registryModels: readonly Model<Api>[],
  providerId: string,
  modelId: string,
): void {
  const match = findRegistryMatch(registryModels, providerId, modelId);
  if (!match) return;
  const { model, providerExact } = match;
  if (model.name) metadata.name = model.name;
  metadata.reasoning = model.reasoning;
  if (model.thinkingLevelMap) {
    metadata.thinkingLevelMap = model.thinkingLevelMap;
  }
  if (model.input.length > 0) metadata.input = [...model.input];
  if (model.contextWindow > 0) metadata.contextWindow = model.contextWindow;
  if (model.maxTokens > 0) metadata.maxTokens = model.maxTokens;
  if (providerExact) {
    if (hasCost(model.cost)) metadata.cost = model.cost;
    if (model.compat) metadata.compat = model.compat;
    return;
  }

  // Model-id fallback: copy only the model-intrinsic compat fields. Cost and
  // endpoint-specific quirks stay out (see INTRINSIC_COMPAT_KEYS).
  if (model.compat) {
    const source = model.compat as Record<string, unknown>;
    const intrinsic: Record<string, unknown> = {};
    for (const key of INTRINSIC_COMPAT_KEYS) {
      if (source[key] !== undefined) intrinsic[key] = source[key];
    }
    if (Object.keys(intrinsic).length > 0) {
      metadata.compat = intrinsic as NonNullable<ModelMetadata["compat"]>;
    }
  }
}
