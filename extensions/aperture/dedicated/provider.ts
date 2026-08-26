import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import type { HostProviderConfig } from "../../shared/types";

export const DEDICATED_PROVIDER_ID = "aperture";

export interface DedicatedProviderConfigInput {
  baseUrl: string;
  headers?: Record<string, string>;
  /** pi >= 0.84: cache-only restore + networked revalidation, driven by the host. */
  refreshModels: (
    context: RefreshModelsContext,
  ) => Promise<ProviderModelConfig[]>;
  /** omp: no `refreshModels`; the host fetches the catalog and caches it itself. */
  fetchCatalog: () => Promise<ProviderModelConfig[]>;
}

/**
 * Build the dedicated `aperture` provider as a name+config registration.
 *
 * The config form rather than a native pi-ai `Provider` because every host
 * implements it, and pi's config path composes an equivalent native provider:
 * same `refreshModels` contract, same `context.publish`, and stream dispatch
 * through each model's own `api`. That last part is why there is no custom
 * `stream`/`streamSimple` here — the host already routes by `model.api`.
 */
export function buildDedicatedProviderConfig(
  input: DedicatedProviderConfigInput,
): HostProviderConfig {
  return {
    name: "Aperture",
    baseUrl: input.baseUrl,
    // The gateway injects the upstream credential; a literal key is what makes
    // the provider count as configured on both hosts (pi:
    // configuredRequestAuthStatus, omp: ModelRegistry config api keys).
    apiKey: "-",
    ...(input.headers ? { headers: input.headers } : {}),
    refreshModels: input.refreshModels,
    fetchDynamicModels: input.fetchCatalog,
  };
}
