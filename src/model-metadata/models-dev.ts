/**
 * models.dev catalog source (`https://models.dev/api.json`): fetch and
 * per-model metadata extraction.
 */

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelMetadata } from "./types";

export const MODELS_DEV_URL = "https://models.dev/api.json";

/** Subset of a models.dev catalog model entry used for enrichment. */
export interface ModelsDevModel {
  name?: string;
  reasoning?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; output?: number };
  /** Per-million-token USD rates. */
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

/** models.dev catalog keyed by provider id, each with models keyed by id. */
export type ModelsDevCatalog = Record<
  string,
  { models?: Record<string, ModelsDevModel> }
>;

/**
 * Fetch the models.dev catalog. Best-effort: any failure (network, timeout,
 * malformed body) resolves to `null` so enrichment silently degrades to the
 * Pi registry and safe defaults.
 */
export async function fetchModelsDevCatalog(options?: {
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}): Promise<ModelsDevCatalog | null> {
  const fetchFn = options?.fetchFn ?? fetch;
  const timeoutSignal = AbortSignal.timeout(options?.timeoutMs ?? 10_000);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeoutSignal])
    : timeoutSignal;
  try {
    const res = await fetchFn(MODELS_DEV_URL, { signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    return body as ModelsDevCatalog;
  } catch {
    return null;
  }
}

function toInputModalities(
  input: string[] | undefined,
): ("text" | "image")[] | undefined {
  if (!input) return undefined;
  const mapped = input.filter(
    (m): m is "text" | "image" => m === "text" || m === "image",
  );
  return mapped.length > 0 ? mapped : undefined;
}

function costFromModelsDev(
  cost: ModelsDevModel["cost"],
): Model<Api>["cost"] | undefined {
  if (!cost || (cost.input === undefined && cost.output === undefined)) {
    return undefined;
  }
  return {
    input: cost.input ?? 0,
    output: cost.output ?? 0,
    cacheRead: cost.cache_read ?? 0,
    cacheWrite: cost.cache_write ?? 0,
  };
}

interface CatalogMatch {
  model: ModelsDevModel;
  providerExact: boolean;
}

function findModelsDevMatch(
  catalog: ModelsDevCatalog,
  providerId: string,
  modelId: string,
): CatalogMatch | null {
  const exact = catalog[providerId]?.models?.[modelId];
  if (exact) return { model: exact, providerExact: true };

  // Fallback: scan all providers for the model id, but only trust a unique
  // match. Context/output limits can genuinely differ for the same model id
  // across serving providers, so an ambiguous match is worse than defaults.
  let found: ModelsDevModel | null = null;
  for (const provider of Object.values(catalog)) {
    const model = provider?.models?.[modelId];
    if (!model) continue;
    if (found) return null;
    found = model;
  }
  return found ? { model: found, providerExact: false } : null;
}

/**
 * Apply models.dev metadata for one gateway model onto `metadata`. A
 * provider-exact match copies capabilities and cost; a unique model-id
 * fallback match copies capabilities only (the same model id can be priced
 * differently by another serving provider). No match leaves `metadata`
 * untouched.
 */
export function applyModelsDevMetadata(
  metadata: ModelMetadata,
  catalog: ModelsDevCatalog,
  providerId: string,
  modelId: string,
): void {
  const match = findModelsDevMatch(catalog, providerId, modelId);
  if (!match) return;
  const { model, providerExact } = match;
  if (model.name) metadata.name = model.name;
  if (model.reasoning !== undefined) metadata.reasoning = model.reasoning;
  const input = toInputModalities(model.modalities?.input);
  if (input) metadata.input = input;
  if (model.limit?.context) metadata.contextWindow = model.limit.context;
  if (model.limit?.output) metadata.maxTokens = model.limit.output;
  if (providerExact) {
    const cost = costFromModelsDev(model.cost);
    if (cost) metadata.cost = cost;
  }
}
