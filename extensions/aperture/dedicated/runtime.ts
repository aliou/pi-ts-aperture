import type { AnyModel } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { refreshDedicatedCatalog } from "../../../src/provider/catalog";
import {
  createDedicatedProvider,
  DEDICATED_PROVIDER_ID,
  type RefreshDedicatedCatalog,
} from "../../../src/provider/dedicated";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../../src/url";
import { compatUpstreams } from "../../shared/api-routing";
import { configLoader } from "../../shared/config/loader";

/**
 * Supplier of Pi's native registry models, used for upstream base URL
 * inference and capability metadata. It is a function because refreshes read
 * the registry at call time: the extension factory registers the provider
 * before any registry access exists (`session_start` provides it), and later
 * refreshes must see a live view, not a snapshot.
 */
export type GetRegistryModels = () => AnyModel[];

function dedicatedCatalogRefresh(
  getModels: GetRegistryModels,
  notify?: (warning: string) => void,
): RefreshDedicatedCatalog {
  return (context) => {
    const config = configLoader.getConfig();
    if (!config.dedicated.enabled) return Promise.resolve([]);
    const gatewayUrl = resolveGatewayUrl(config);
    const baseUrl = resolveProviderBaseUrl(config);
    if (!gatewayUrl || !baseUrl) return Promise.resolve([]);

    return refreshDedicatedCatalog(context, {
      gatewayUrl,
      baseUrl,
      providers: config.dedicated.providers,
      getRegistryModels: getModels,
      notify,
    });
  };
}

/**
 * Register the dedicated `aperture` provider with a `refreshModels` hook.
 *
 * Pi immediately fires a cache-only refresh after registration, restoring the
 * previous catalog from `models-store.json` so scoped models validate during
 * startup. The networked revalidation happens when `session_start` calls
 * `ctx.modelRegistry.refresh()`.
 *
 * No-ops when dedicated is disabled or the gateway URL is unset.
 */
export function registerDedicatedProvider(
  pi: Pick<ExtensionAPI, "registerProvider">,
  getModels: GetRegistryModels,
  notify?: (warning: string) => void,
): void {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled) return;

  const baseUrl = resolveProviderBaseUrl(config);
  if (!baseUrl) return;

  pi.registerProvider(
    createDedicatedProvider(
      baseUrl,
      dedicatedCatalogRefresh(getModels, notify),
      compatUpstreams,
    ),
  );
}

/**
 * Reconcile registration with the current config: registers (or re-registers,
 * picking up a changed gateway base URL) when dedicated is enabled, and
 * unregisters when it is disabled or the gateway URL is unset.
 */
export function reconcileDedicatedProvider(
  pi: Pick<ExtensionAPI, "registerProvider" | "unregisterProvider">,
  getModels: GetRegistryModels,
  notify?: (warning: string) => void,
): void {
  const config = configLoader.getConfig();
  if (!config.dedicated.enabled || !resolveProviderBaseUrl(config)) {
    pi.unregisterProvider(DEDICATED_PROVIDER_ID);
    return;
  }
  registerDedicatedProvider(pi, getModels, notify);
}
