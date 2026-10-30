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

/**
 * Trailing id segments that mark a variant or snapshot of a model family:
 * `-1017`, `-001`, `-Fast`, `-preview`, ...
 */
const SNAPSHOT_SUFFIX =
  /-(?:\d{2,4}|fast|turbo|preview|latest|beta|experimental|exp)$/i;

/**
 * Candidate family ids for `modelId`, nearest ancestor first. Strips one
 * trailing variant segment at a time so both `x-1017` and `x-1017-fast`
 * resolve to `x`.
 */
function familyIds(modelId: string): string[] {
  const ids: string[] = [];
  let current = modelId;
  for (;;) {
    const suffix = current.match(SNAPSHOT_SUFFIX);
    if (!suffix) break;
    current = current.slice(0, current.length - suffix[0].length);
    ids.push(current);
  }
  return ids;
}

type RegistryMatchKind = "provider-exact" | "sibling" | "model-id";

interface RegistryMatch {
  model: Model<Api>;
  kind: RegistryMatchKind;
}

/**
 * Same-provider family match: `together/x-1017` falls back to
 * `together/x`. Endpoint quirks and thinking levels are family properties, so
 * a sibling describes the request Pi is about to make far better than an
 * exact-id match from an unrelated provider.
 */
function findSiblingMatch(
  registryModels: readonly Model<Api>[],
  providerId: string,
  modelId: string,
): RegistryMatch | null {
  for (const candidate of familyIds(modelId)) {
    const sibling = registryModels.find(
      (m) =>
        m.provider === providerId &&
        m.id.toLowerCase() === candidate.toLowerCase(),
    );
    if (sibling) return { model: sibling, kind: "sibling" };
  }
  return null;
}

function findRegistryMatch(
  registryModels: readonly Model<Api>[],
  providerIds: readonly string[],
  modelId: string,
  siblingMatch: boolean,
): RegistryMatch | null {
  for (const providerId of providerIds) {
    const exact = registryModels.find(
      (m) => m.provider === providerId && m.id === modelId,
    );
    if (exact) return { model: exact, kind: "provider-exact" };
  }
  if (siblingMatch) {
    for (const providerId of providerIds) {
      const sibling = findSiblingMatch(registryModels, providerId, modelId);
      if (sibling) return sibling;
    }
  }
  const byId = registryModels.find((m) => m.id === modelId);
  return byId ? { model: byId, kind: "model-id" } : null;
}

/**
 * Apply Pi registry metadata for one gateway model onto `metadata`. A
 * provider-exact match copies everything including cost and `compat`; a
 * same-provider sibling match copies capabilities and `compat` but keeps the
 * model's own name and cost; a model-id fallback match copies capabilities
 * only (cost and endpoint quirks are provider-specific). No match leaves
 * `metadata` untouched.
 */
export function applyRegistryMetadata(
  metadata: ModelMetadata,
  registryModels: readonly Model<Api>[],
  providerIds: string | readonly string[],
  modelId: string,
  siblingMatch = false,
): void {
  const match = findRegistryMatch(
    registryModels,
    typeof providerIds === "string" ? [providerIds] : providerIds,
    modelId,
    siblingMatch,
  );
  if (!match) return;
  const { model, kind } = match;
  // Variants carry their own name (`... 1017`); the family name would hide it.
  if (model.name && kind !== "sibling") metadata.name = model.name;
  metadata.reasoning = model.reasoning;
  if (model.thinkingLevelMap) {
    metadata.thinkingLevelMap = model.thinkingLevelMap;
  }
  if (model.input.length > 0) metadata.input = [...model.input];
  if (model.contextWindow > 0) metadata.contextWindow = model.contextWindow;
  if (model.maxTokens > 0) metadata.maxTokens = model.maxTokens;
  if (kind === "provider-exact" || kind === "sibling") {
    if (kind === "provider-exact" && hasCost(model.cost)) {
      metadata.cost = model.cost;
    }
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
