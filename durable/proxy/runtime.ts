import type { Api, Provider } from "@earendil-works/pi-ai";
import { ApertureClient } from "../api/client";
import type { ApertureProvider } from "../api/types";
import { isSelectableApi } from "../provider/api-selection";
import type {
  ApertureProxyRoute,
  ApertureProxyRouting,
  ApertureProxySyncResult,
} from "../proxy";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../url";
import { wrapProxyProvider } from "./wrapper";

export interface ProxyDeps {
  getProvider: (id: string) => Provider | undefined;
  registerProvider: (provider: Provider) => void;
  onWarning?: (message: string) => void;
}

interface ProxyRecord {
  original: Provider;
  installed: Provider;
  wrapper?: Provider;
  upstreamBaseUrl?: string;
}

interface CatalogResult {
  providers?: ApertureProvider[];
  catalogError?: Error;
}

interface SyncResult extends CatalogResult, ApertureProxySyncResult {}

export async function fetchProxyCatalog(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<CatalogResult> {
  try {
    return { providers: await new ApertureClient(baseUrl).providers(signal) };
  } catch (error) {
    return {
      catalogError: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const aborted = () => resolve(undefined);
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

export class ProxyRuntime {
  private readonly records = new Map<string, ProxyRecord>();
  private passthrough = new Set<string>();
  private generation = 0;
  private pending?: AbortController;

  cancel(): void {
    this.generation++;
    this.pending?.abort();
    this.pending = undefined;
  }

  private restoreRecord(id: string, deps: ProxyDeps): void {
    const record = this.records.get(id);
    if (!record) return;
    if (record.wrapper && deps.getProvider(id) === record.installed)
      deps.registerProvider(record.original);
    this.records.delete(id);
  }

  restore(deps: ProxyDeps): void {
    this.cancel();
    for (const id of this.records.keys()) this.restoreRecord(id, deps);
    this.passthrough.clear();
  }

  restoreRemoved(deps: ProxyDeps, routes: readonly ApertureProxyRoute[]): void {
    this.cancel();
    const selected = new Set(
      routes
        .filter((route) => route.enabled !== false)
        .map((route) => route.id),
    );
    for (const id of this.records.keys()) {
      if (!selected.has(id)) this.restoreRecord(id, deps);
    }
  }

  private capture(id: string, deps: ProxyDeps): ProxyRecord | undefined {
    const current = deps.getProvider(id);
    if (!current) {
      this.records.delete(id);
      return undefined;
    }
    const existing = this.records.get(id);
    if (existing && current === existing.installed) return existing;
    const model = current.getModels()[0] ?? current.getAllModels?.()[0];
    if (!model) return undefined;
    const record = {
      original: current,
      installed: current,
      upstreamBaseUrl: model.baseUrl,
    };
    this.records.set(id, record);
    return record;
  }

  private install(
    route: ApertureProxyRoute,
    record: ProxyRecord,
    routing: ApertureProxyRouting,
    deps: ProxyDeps,
    catalog?: ApertureProvider[],
    settled = false,
  ): void {
    const generation = this.generation;
    if (deps.getProvider(route.id) !== record.installed) return;
    const gateway = catalog?.find(
      (provider) => provider.id === route.gatewayId,
    );
    const sourceApi =
      record.original.getModels()[0]?.api ?? "openai-completions";
    let apiOverride: Api | undefined;
    if (route.api && gateway?.compatibility) {
      if (isSelectableApi(route.api, gateway.compatibility))
        apiOverride = route.api;
      else
        deps.onWarning?.(
          `[aperture] api override "${route.api}" for proxied provider ${route.id} is not served by the gateway; falling back to the provider's own api (${sourceApi}).`,
        );
    }
    const servedIds =
      gateway && route.keepGatewayModelsOnly
        ? new Set(gateway.models)
        : undefined;
    const gatewayRoot = resolveGatewayUrl(routing);
    const baseUrl = resolveProviderBaseUrl(routing);
    if (!gatewayRoot || !baseUrl) return;
    if (!settled && !record.original.auth?.apiKey) return;
    const models =
      record.original.getAllModels?.() ?? record.original.getModels();
    if (
      !record.wrapper &&
      servedIds &&
      !models.some((model) => servedIds.has(model.id))
    )
      return;
    const wrapper = wrapProxyProvider(record.original, {
      gatewayId: route.gatewayId,
      gatewayRoot,
      baseUrl,
      upstreamBaseUrl: record.upstreamBaseUrl,
      apiOverride,
      passthrough: this.passthrough.has(route.gatewayId),
      servedIds,
    });
    const wrapped: Provider = {
      ...wrapper,
      id: route.id,
      name: record.original.name ?? route.id,
    };
    if (generation !== this.generation) return;
    if (this.records.get(route.id) !== record) return;
    if (deps.getProvider(route.id) !== record.installed) return;
    if (record.wrapper) Object.assign(record.wrapper, wrapped);
    else record.wrapper = wrapped;
    deps.registerProvider(record.wrapper);
    record.installed = deps.getProvider(route.id) ?? record.wrapper;
  }

  async sync(
    routing: ApertureProxyRouting,
    deps: ProxyDeps,
    callerSignal?: AbortSignal,
  ): Promise<SyncResult> {
    this.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.pending = controller;
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, controller.signal])
      : controller.signal;
    const stale = () => signal.aborted || generation !== this.generation;
    if (stale()) return { aborted: true };
    const gateway = resolveGatewayUrl(routing);
    if (!gateway) return { aborted: false };
    const routes = routing.providers
      .filter((route) => route.enabled !== false && route.id !== "aperture")
      .map((route) => ({ ...route }));
    if (!routes.length) return { aborted: false };
    const catalogPromise = fetchProxyCatalog(gateway, signal);
    const records = new Map<string, ProxyRecord>();
    for (const route of routes) {
      if (stale()) return { aborted: true };
      const record = this.capture(route.id, deps);
      if (!record) continue;
      records.set(route.id, record);
      this.install(route, record, routing, deps);
    }
    const catalog = await abortable(catalogPromise, signal);
    if (stale() || !catalog) return { aborted: true };
    if (catalog.providers)
      this.passthrough = new Set(
        catalog.providers
          .filter((p) => p.requires_client_auth)
          .map((p) => p.id),
      );
    const warned = new Set<string>();
    for (const route of routes) {
      if (stale()) return { aborted: true };
      const record = records.get(route.id);
      if (!record) continue;
      if (deps.getProvider(route.id) !== record.installed) continue;
      const unknown =
        catalog.providers &&
        (route.gatewayId === "aperture" ||
          !catalog.providers.some((p) => p.id === route.gatewayId));
      if (unknown) {
        if (!warned.has(route.gatewayId))
          deps.onWarning?.(
            `[aperture] gateway provider "${route.gatewayId}" not found; provider "${route.id}" left unrouted.`,
          );
        warned.add(route.gatewayId);
        this.restoreRecord(route.id, deps);
        continue;
      }
      this.install(route, record, routing, deps, catalog.providers, true);
    }
    if (generation === this.generation) this.pending = undefined;
    return { ...catalog, aborted: Boolean(stale()) };
  }

  warnMissing(
    routing: ApertureProxyRouting,
    deps: Pick<ProxyDeps, "onWarning" | "getProvider">,
    catalog?: ApertureProvider[],
  ): void {
    if (!catalog?.length) return;
    const missing = new Map<string, string[]>();
    for (const route of routing.providers) {
      if (route.enabled === false || !route.shouldCheckGatewayModels) continue;
      const gateway = catalog.find((p) => p.id === route.gatewayId);
      if (!gateway) continue;
      const models = deps.getProvider(route.id)?.getModels() ?? [];
      const ids = models
        .filter((m) => !gateway.models.includes(m.id))
        .map((m) => m.id);
      if (ids.length) missing.set(route.id, ids);
    }
    if (!missing.size) return;
    const summary = [...missing]
      .map(
        ([id, ids]) =>
          `${id}: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? `, ${ids.length - 5} more` : ""}`,
      )
      .join("; ");
    deps.onWarning?.(
      `[aperture] models not available on gateway: ${summary}. Add them to the gateway configuration.`,
    );
  }
}
