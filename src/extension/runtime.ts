/**
 * ApertureRuntime -- core extension runtime logic.
 *
 * Handles provider registration, unregistration, and gateway model checking.
 */

import { configLoader } from "../lib/config";
import { fetchGatewayModelIds } from "../lib/gateway";
import type { Api, CheckDeps, Model, SyncDeps } from "../lib/types";
import { resolveProviderBaseUrl } from "../lib/url";

/**
 * Preserve provenance similarly to pi-synthetic so downstream providers can
 * attribute traffic to Pi / this extension.
 */
const APERTURE_PROVENANCE_HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

function resolveProviderHeaders(models: Model<Api>[]): Record<string, string> {
  const modelHeaders = models.find((m) => m.headers)?.headers ?? {};
  return {
    ...APERTURE_PROVENANCE_HEADERS,
    ...modelHeaders,
  };
}

export class ApertureRuntime {
  private registeredProviders = new Set<string>();

  async sync(deps: SyncDeps): Promise<void> {
    const config = configLoader.getConfig();
    if (!config.baseUrl || config.providers.length === 0) {
      return;
    }

    const baseUrl = resolveProviderBaseUrl(config);
    if (!baseUrl) return;

    const allModels = deps.getModels();

    for (const providerName of config.providers) {
      const providerModels = allModels.filter(
        (m) => m.provider === providerName,
      );
      if (providerModels.length === 0) continue;

      deps.registerProvider(providerName, {
        baseUrl,
        apiKey: "-",
        headers: resolveProviderHeaders(providerModels),
        api: providerModels[0].api ?? "openai-completions",
        models: providerModels,
      });

      this.registeredProviders.add(providerName);
    }
  }

  async checkMissingModels(deps: CheckDeps, gatewayUrl: string): Promise<void> {
    const config = configLoader.getConfig();
    if (config.checkGatewayModels.length === 0) return;

    const gatewayModelIds = await fetchGatewayModelIds(gatewayUrl);
    if (gatewayModelIds.length === 0) return;

    const allModels = deps.getModels();
    const checkedProviders = new Set(config.checkGatewayModels);

    const routedModels = allModels.filter((m) =>
      checkedProviders.has(m.provider),
    );
    const missingModels = routedModels.filter(
      (m) => !gatewayModelIds.includes(m.id),
    );

    if (missingModels.length > 0) {
      const ids = missingModels.map((m) => m.id).join(", ");
      deps.notify(
        `[aperture] models not available on gateway: ${ids}. Add them to the gateway configuration.`,
        "warning",
      );
    }
  }

  /**
   * Returns providers that should be unregistered based on config changes.
   * Compares previous providers with new ones.
   */
  getProvidersToUnregister(
    prevProviders: string[],
    nextProviders: string[],
  ): string[] {
    return prevProviders.filter((p) => !nextProviders.includes(p));
  }
}
