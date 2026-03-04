export interface ApertureProviderInfo {
  id?: string;
  models?: string[];
}

/**
 * Fetch provider -> model list mapping from Aperture and keep only selected
 * providers configured by the user.
 */
export async function fetchApertureProviderModels(
  gatewayUrl: string,
  providers: string[],
): Promise<Map<string, string[]>> {
  const response = await fetch(`${gatewayUrl}/api/providers`, {
    signal: AbortSignal.timeout(4000),
  });

  if (!response.ok) {
    return new Map();
  }

  const data = (await response.json()) as ApertureProviderInfo[];
  const selectedProviders = new Set(providers);
  const modelsByProvider = new Map<string, string[]>();

  for (const provider of data) {
    if (!provider.id || !selectedProviders.has(provider.id)) continue;
    modelsByProvider.set(provider.id, provider.models ?? []);
  }

  return modelsByProvider;
}
