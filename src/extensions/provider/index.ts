import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Api } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { CachedModel } from "../../lib/config";
import { configLoader } from "../../lib/config";
import {
  fetchGatewayModels,
  fetchGatewayProviderCompatibility,
  type GatewayModel,
} from "../../lib/gateway";
import {
  buildCachedModelConfig,
  buildDefaultModelConfig,
  isDefaultModelConfig,
  toCachedModel,
} from "../../lib/model-defaults";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../lib/url";
import {
  buildStreamSimple,
  getApiForCompatibility,
  getBaseUrlForApi,
  getProviderId,
} from "./api-routing";

const PROVIDER_NAME = "aperture";
const APERTURE_API = "aperture";

const HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

/** Filter cached models by enabled dedicated providers. */
function filterCachedModels(
  cached: CachedModel[],
  enabledProviderIds: Set<string>,
): CachedModel[] {
  return enabledProviderIds.size > 0
    ? cached.filter((m) => enabledProviderIds.has(m.providerId))
    : cached;
}

/** Filter gateway models by enabled dedicated providers. */
function filterGatewayModels(
  models: GatewayModel[],
  enabledProviderIds: Set<string>,
): GatewayModel[] {
  return enabledProviderIds.size > 0
    ? models.filter((m) => enabledProviderIds.has(m.providerId))
    : models;
}

/** Load user-defined model entries from models.json for the aperture provider. */
function loadUserModels(): Map<string, ProviderModelConfig> {
  const result = new Map<string, ProviderModelConfig>();
  try {
    const modelsPath = join(getAgentDir(), "models.json");
    if (!existsSync(modelsPath)) return result;
    const raw = JSON.parse(readFileSync(modelsPath, "utf-8"));
    const userModels = raw?.providers?.aperture?.models;
    if (!Array.isArray(userModels)) return result;
    for (const m of userModels) {
      if (m?.id) result.set(m.id, m as ProviderModelConfig);
    }
  } catch {
    // models.json missing or invalid — ignore
  }
  return result;
}

/** Merge default model configs with user-defined models from models.json.
 *
 * User-defined entries take precedence over defaults.
 * User models not in the gateway list are also included (manually added).
 */
function mergeWithUserModels(
  defaults: Map<string, ProviderModelConfig>,
  userModels: Map<string, ProviderModelConfig>,
): Map<string, ProviderModelConfig> {
  const merged = new Map<string, ProviderModelConfig>();

  // Start with defaults, override with user entries, but keep gateway-derived
  // cost when the user entry does not define one.
  for (const [id, defaultCfg] of defaults) {
    const userCfg = userModels.get(id);
    merged.set(
      id,
      userCfg
        ? { ...defaultCfg, ...userCfg, cost: userCfg.cost ?? defaultCfg.cost }
        : defaultCfg,
    );
  }

  // Include user models not in gateway (manually added)
  for (const [id, userCfg] of userModels) {
    if (!merged.has(id)) {
      merged.set(id, userCfg);
    }
  }

  return merged;
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const config = configLoader.getConfig();
  const gatewayUrl = resolveGatewayUrl(config);
  const baseUrl = resolveProviderBaseUrl(config);

  if (config.mode !== "dedicated" || !gatewayUrl || !baseUrl) return;

  const targetApiByProviderId = new Map<string, Api>();
  const streamSimple = buildStreamSimple(targetApiByProviderId);

  const enabledProviderIds = new Set(
    config.dedicated.providers.filter((p) => p.enabled).map((p) => p.id),
  );

  // --- Register cached models immediately (no network) ---
  const cached = filterCachedModels(
    config.dedicated.cachedModels,
    enabledProviderIds,
  );
  const cachedModelConfigs: ProviderModelConfig[] = cached.map(
    buildCachedModelConfig,
  );

  if (cachedModelConfigs.length > 0) {
    pi.registerProvider(PROVIDER_NAME, {
      baseUrl,
      apiKey: "-",
      api: APERTURE_API,
      headers: HEADERS,
      models: cachedModelConfigs,
      streamSimple,
    });
  }

  // --- Fetch fresh models in background, re-register if changed ---
  const [gatewayModels, providerCompatibility] = await Promise.all([
    fetchGatewayModels(gatewayUrl),
    fetchGatewayProviderCompatibility(gatewayUrl),
  ]);
  const filteredModels = filterGatewayModels(gatewayModels, enabledProviderIds);

  // Build default configs for all gateway models
  const defaultModelConfigs = new Map<string, ProviderModelConfig>();
  for (const gm of filteredModels) {
    const api = getApiForCompatibility(
      providerCompatibility.get(gm.providerId),
    );
    targetApiByProviderId.set(gm.providerId, api);
    const cfg = {
      ...buildDefaultModelConfig(gm),
      api: APERTURE_API,
      baseUrl: getBaseUrlForApi(api, gatewayUrl, baseUrl),
    };
    defaultModelConfigs.set(cfg.id, cfg);
  }

  // Merge with user-defined models from models.json
  // User-defined entries take precedence over defaults
  const userModels = loadUserModels();
  const mergedModels = mergeWithUserModels(defaultModelConfigs, userModels);
  const freshModelConfigs = [...mergedModels.values()].map((model) => {
    const targetApi = targetApiByProviderId.get(getProviderId(model.id));
    return targetApi
      ? {
          ...model,
          api: APERTURE_API,
          baseUrl: getBaseUrlForApi(targetApi, gatewayUrl, baseUrl),
        }
      : model;
  });

  // Check if model list changed
  const cachedIds = new Set(cachedModelConfigs.map((m) => m.id));
  const freshIds = new Set(freshModelConfigs.map((m) => m.id));
  const changed =
    cachedIds.size !== freshIds.size ||
    [...freshIds].some((id) => !cachedIds.has(id));

  // Always re-register with fresh data (prices may have changed)
  if (freshModelConfigs.length > 0) {
    pi.registerProvider(PROVIDER_NAME, {
      baseUrl,
      apiKey: "-",
      api: APERTURE_API,
      headers: HEADERS,
      models: freshModelConfigs,
      streamSimple,
    });
  }

  // Expose the sync-aperture-models skill only when models need syncing
  const defaultModels = freshModelConfigs.filter((m) =>
    isDefaultModelConfig(m),
  );
  if (defaultModels.length > 0) {
    pi.on("session_start", (_event, ctx) => {
      const sample = defaultModels.slice(0, 3).map((m) => m.id);
      const more =
        defaultModels.length > 3 ? `, +${defaultModels.length - 3} more` : "";
      ctx.ui.notify(
        `[aperture] ${defaultModels.length} model(s) using default capabilities (128k ctx, 8k out, no reasoning): ${sample.join(", ")}${more}. Run /skill:sync-aperture-models to update.`,
        "info",
      );
    });
  }

  // Persist cache if models changed
  if (changed) {
    const allCached = gatewayModels.map(toCachedModel);
    await configLoader.save("global", {
      ...configLoader.getRawConfig("global"),
      dedicated: {
        ...configLoader.getRawConfig("global")?.dedicated,
        providers: config.dedicated.providers,
        cachedModels: allCached,
      },
    });
  }
}
