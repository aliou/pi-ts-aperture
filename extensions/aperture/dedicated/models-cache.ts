import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Api } from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Stale-while-revalidate disk cache for dedicated Aperture models.
 *
 * Dedicated Aperture models are only discoverable by hitting the authenticated
 * Aperture `/api/providers` endpoint, which we can only do inside
 * `session_start` / `onSync` (Pi does not expose the gateway to the extension
 * factory). However, Pi validates scoped models (e.g.
 * `aperture/<model-id>`) during startup, *before* `session_start` fires. To
 * avoid "No models match pattern" warnings on saved scoped models, we persist
 * the last fetch to disk so the provider can be registered with cached models
 * instantly on the next launch. The first run with no cache still warns once;
 * subsequent runs resolve cleanly.
 *
 * Unlike a plain `ProviderModelConfig[]` cache, dedicated mode uses a custom
 * `"aperture"` API with a `streamSimple` that routes each request to the
 * upstream Aperture API (openai-completions, anthropic-messages, ...). That
 * upstream `api` and per-model `baseUrl` are derived from compatibility at
 * fetch time and are *not* stored on the model config (model.api is the
 * `"aperture"` string), so the cache also persists the modelId -> upstream Api
 * route map. The gateway URL is stored so a stale cache for a different
 * gateway is ignored until revalidation rewrites it.
 *
 * File shape: `{ version: 1, gatewayUrl: string, models: ProviderModelConfig[], routes: Record<string, Api> }`.
 */

const CACHE_VERSION = 1;
const CACHE_FILENAME = "aperture-dedicated-models.json";

function cachePath(): string {
  return join(getAgentDir(), "cache", CACHE_FILENAME);
}

export interface DedicatedModelsCacheFile {
  version?: unknown;
  gatewayUrl?: unknown;
  models?: unknown;
  routes?: unknown;
}

export interface DedicatedModelsCache {
  gatewayUrl: string;
  models: ProviderModelConfig[];
  routes: Record<string, Api>;
}

/**
 * Read cached dedicated models synchronously.
 *
 * Designed to be called from the provider extension factory body, where Pi
 * has not entered the event loop yet. Returns `null` if the cache is missing,
 * unreadable, malformed, or for a different gateway URL.
 */
export function loadCachedDedicatedModels(
  expectedGatewayUrl: string,
): DedicatedModelsCache | null {
  try {
    const path = cachePath();
    if (!existsSync(path)) return null;

    const parsed: DedicatedModelsCacheFile = JSON.parse(
      readFileSync(path, "utf8"),
    );
    if (parsed.version !== CACHE_VERSION) return null;
    if (typeof parsed.gatewayUrl !== "string") return null;
    if (parsed.gatewayUrl !== expectedGatewayUrl) return null;
    if (!Array.isArray(parsed?.models)) return null;
    if (
      parsed.routes === null ||
      typeof parsed.routes !== "object" ||
      Array.isArray(parsed.routes)
    ) {
      return null;
    }

    return {
      gatewayUrl: parsed.gatewayUrl,
      models: parsed.models as ProviderModelConfig[],
      routes: parsed.routes as Record<string, Api>,
    };
  } catch {
    return null;
  }
}

/**
 * Persist dedicated models to disk for the next startup.
 *
 * Called after a successful `/api/providers` fetch. Failures are swallowed
 * since a missing cache only degrades to first-run behavior.
 */
export async function writeCachedDedicatedModels(
  gatewayUrl: string,
  models: ProviderModelConfig[],
  routes: Map<string, Api>,
): Promise<void> {
  try {
    const path = cachePath();
    await mkdir(dirname(path), { recursive: true });
    const routesRecord: Record<string, Api> = {};
    for (const [modelId, api] of routes) routesRecord[modelId] = api;
    await writeFile(
      path,
      `${JSON.stringify(
        { version: CACHE_VERSION, gatewayUrl, models, routes: routesRecord },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch (error) {
    // Cache writes are best-effort. A missing cache only falls back to the
    // first-run path (next session revalidates and writes again).
    void error;
  }
}
