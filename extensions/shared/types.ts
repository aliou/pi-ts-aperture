/**
 * Internal types for Aperture extension.
 */

import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type {
  ProviderConfig,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";

export type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  Provider,
  ProviderConfig,
  ProviderModelConfig,
  SimpleStreamOptions,
};

/**
 * `ProviderConfig` plus omp's dynamic-catalog hook. pi refreshes through
 * `refreshModels` and ignores `fetchDynamicModels`; omp has no `refreshModels`
 * and calls `fetchDynamicModels`, caching the result until
 * `modelRegistry.refreshProvider(id, "online")` clears it. Neither host
 * validates unknown config keys, so one object serves both.
 */
export type HostProviderConfig = ProviderConfig & {
  fetchDynamicModels?: (apiKey?: string) => Promise<ProviderModelConfig[]>;
};

/**
 * Dependencies for ApertureRuntime.sync()
 */
export interface SyncDeps {
  /** Native provider access. Absent on hosts whose registry has no `getProvider` (omp). */
  getProvider?: (id: string) => Provider | undefined;
  /** Native provider registration. Absent on the same hosts. */
  registerNativeProvider?: (provider: Provider) => void;
  /** Name+config registration. Every host implements this. */
  registerProviderConfig: (name: string, config: HostProviderConfig) => void;
  getModels: () => Model<Api>[];
  /** Provenance headers to bake into config registrations. */
  headers?: Record<string, string>;
  notify?: (msg: string, type: "warning" | "info") => void;
}

/**
 * Dependencies for ApertureRuntime.checkMissingModels()
 */
export interface CheckDeps {
  getModels: () => Model<Api>[];
  notify: (msg: string, type: "warning" | "info") => void;
}
