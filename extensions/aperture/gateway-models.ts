import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ApertureModelLimits,
  ApertureModelPricing,
} from "../../src/api/types";
import type { ModelMetadata } from "../../src/model-metadata";
import { buildDefaultModelConfig } from "./dedicated/model-defaults";

/** Marks a model the gateway serves but Pi's catalog does not list. */
export const UNCATALOGUED_NAME_SUFFIX = " (uncatalogued)";

/**
 * Build one chat model from a gateway catalog entry.
 *
 * Shared by the dedicated provider (every gateway model) and the proxy's
 * `generateAdditionalModelsFromGateway` synthesis (gateway models Pi's catalog
 * does not list), so a model served by both providers keeps identical metadata,
 * pricing, and limits.
 */
export interface GatewayChatModelInput {
  /** Model id as Pi stores it: bare for the proxy, `provider/id` for dedicated. */
  id: string;
  /** Pi provider that owns the entry. */
  provider: string;
  /** Display name; defaults to `id`. */
  name?: string;
  /** Appended after display-name resolution, so metadata names keep the mark. */
  nameSuffix?: string;
  api: Api;
  baseUrl: string;
  pricing?: ApertureModelPricing;
  limits?: ApertureModelLimits;
  metadata?: ModelMetadata;
}

export function buildGatewayChatModel(
  input: GatewayChatModelInput,
): Model<Api> {
  const config = buildDefaultModelConfig({
    id: input.id,
    name: input.name ?? input.id,
    providerId: input.provider,
    pricing: input.pricing,
    limits: input.limits,
    metadata: input.metadata,
  });
  return {
    provider: input.provider,
    ...config,
    name: input.nameSuffix ? `${config.name}${input.nameSuffix}` : config.name,
    api: input.api,
    baseUrl: input.baseUrl,
  };
}
