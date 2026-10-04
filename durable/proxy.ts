import type { Api, Provider } from "@earendil-works/pi-ai";
import { ProxyRuntime } from "./proxy/runtime";

export interface ApertureProxyRoute {
  id: string;
  gatewayId: string;
  enabled?: boolean;
  api?: Api;
  keepGatewayModelsOnly?: boolean;
  shouldCheckGatewayModels?: boolean;
}

export interface ApertureProxyRouting {
  baseUrl: string;
  providers: readonly ApertureProxyRoute[];
}

export interface ApertureProxyOptions extends ApertureProxyRouting {
  getProvider: (id: string) => Provider | undefined;
  registerProvider: (provider: Provider) => void;
  onWarning?: (message: string) => void;
}

export interface ApertureProxySyncOptions
  extends Partial<ApertureProxyRouting> {
  signal?: AbortSignal;
}

export interface ApertureProxySyncResult {
  aborted: boolean;
  catalogError?: Error;
}

export interface ApertureProxy {
  sync(options?: ApertureProxySyncOptions): Promise<ApertureProxySyncResult>;
  restore(): void;
}

export function createApertureProxy(
  options: ApertureProxyOptions,
): ApertureProxy {
  const runtime = new ProxyRuntime();
  const deps = {
    getProvider: options.getProvider,
    registerProvider: options.registerProvider,
    onWarning: options.onWarning,
  };
  let routing: ApertureProxyRouting = options;
  return {
    sync: async (next = {}) => {
      if (next.signal?.aborted) {
        runtime.cancel();
        return { aborted: true };
      }
      routing = {
        baseUrl: next.baseUrl ?? routing.baseUrl,
        providers: next.providers ?? routing.providers,
      };
      runtime.restoreRemoved(deps, routing.providers);
      const result = await runtime.sync(routing, deps, next.signal);
      if (!result.aborted) runtime.warnMissing(routing, deps, result.providers);
      return { aborted: result.aborted, catalogError: result.catalogError };
    },
    restore: () => runtime.restore(deps),
  };
}
