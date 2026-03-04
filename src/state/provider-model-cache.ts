/**
 * In-memory cache for Aperture provider model discovery.
 *
 * Ephemeral by design: reset on config changes and process restart.
 */
let providerModelsCache: Map<string, string[]> | null = null;

export function getProviderModelsCache(): Map<string, string[]> | null {
  return providerModelsCache;
}

export function setProviderModelsCache(models: Map<string, string[]>): void {
  providerModelsCache = models;
}

export function clearProviderModelsCache(): void {
  providerModelsCache = null;
}
