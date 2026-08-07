/**
 * Model metadata resolution for dedicated mode.
 *
 * Aperture's `/v1/models` only reports model ids and pricing, so capability
 * metadata (vision input, reasoning, context window, output limit) must come
 * from elsewhere. This module layers two sources on top of the safe defaults:
 *
 * 1. models.dev catalog (`models-dev.ts`) - broad coverage, fetched
 *    best-effort at refresh time.
 * 2. Pi's native model registry (`pi-registry.ts`) - authoritative when it
 *    knows the model (includes `thinkingLevelMap` and `compat`, which
 *    models.dev lacks).
 *
 * The registry wins over models.dev; gateway pricing is applied later by the
 * caller and wins over both. Matching prefers an exact provider-id + model-id
 * match. A model-id-only fallback match copies capabilities but never cost
 * (the same model id can be served with different pricing by e.g. OpenRouter).
 * It copies only the model-intrinsic `compat` fields
 * (`supportsDeveloperRole`, `maxTokensField`,
 * `requiresReasoningContentOnAssistantMessages`) - endpoint quirks such as
 * `supportsStore` or `deferredToolsMode` are provider-specific and stay out.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import { applyModelsDevMetadata, type ModelsDevCatalog } from "./models-dev";
import { applyRegistryMetadata } from "./pi-registry";
import type { ModelMetadata } from "./types";

export {
  fetchModelsDevCatalog,
  MODELS_DEV_URL,
  type ModelsDevCatalog,
  type ModelsDevModel,
} from "./models-dev";
export type { ModelMetadata } from "./types";

export interface ModelMetadataSources {
  /**
   * Pi registry models to match against. The caller must pre-filter models
   * that would self-reference (e.g. the dedicated `aperture` provider's own
   * previously registered models, which carry the safe defaults).
   */
  registryModels?: readonly Model<Api>[];
  modelsDev?: ModelsDevCatalog | null;
}

/**
 * Resolve capability metadata for one gateway model.
 *
 * Applies models.dev first, then the Pi registry on top (registry wins where
 * both know the model). Returns only the fields a source actually provided;
 * the caller merges over safe defaults and applies gateway pricing last.
 */
export function resolveModelMetadata(
  providerId: string,
  modelId: string,
  sources: ModelMetadataSources,
): ModelMetadata {
  const metadata: ModelMetadata = {};

  if (sources.modelsDev) {
    applyModelsDevMetadata(metadata, sources.modelsDev, providerId, modelId);
  }

  if (sources.registryModels && sources.registryModels.length > 0) {
    applyRegistryMetadata(
      metadata,
      sources.registryModels,
      providerId,
      modelId,
    );
  }

  return metadata;
}
