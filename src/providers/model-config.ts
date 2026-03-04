import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

const DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

/**
 * Build a ProviderModelConfig for Aperture-discovered model IDs.
 *
 * When a template model is available (same provider), preserve its API/compat
 * shape so behavior stays consistent after rerouting.
 */
export function toModelConfig(
  id: string,
  template?: ProviderModelConfig,
): ProviderModelConfig {
  return {
    id,
    name: template?.name ?? id,
    api: template?.api ?? "openai-completions",
    reasoning: template?.reasoning ?? false,
    input: template?.input ?? ["text"],
    cost: template?.cost ?? DEFAULT_COST,
    contextWindow: template?.contextWindow ?? 128000,
    maxTokens: template?.maxTokens ?? 16384,
    headers: template?.headers,
    compat: template?.compat,
  };
}

/**
 * Merge known provider models with Aperture-discovered model IDs.
 * Existing models win; missing IDs are synthesized from template defaults.
 */
export function mergeModels(
  existingModels: ProviderModelConfig[],
  apertureModelIds: string[] | undefined,
): ProviderModelConfig[] {
  if (!apertureModelIds || apertureModelIds.length === 0) return existingModels;

  const modelsById = new Map(existingModels.map((m) => [m.id, m]));
  const template = existingModels[0];

  for (const modelId of apertureModelIds) {
    if (!modelsById.has(modelId)) {
      modelsById.set(modelId, toModelConfig(modelId, template));
    }
  }

  return [...modelsById.values()];
}
