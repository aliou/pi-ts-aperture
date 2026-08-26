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
 * Native provider access. Absent as a whole on hosts whose model registry has
 * no `getProvider`, which is why it is one optional object rather than two
 * optional functions: half a pair would fall to the config branch, and that
 * branch breaks routing on pi (see the note in `ApertureRuntime.sync`).
 */
export interface NativeProviderDeps {
  getProvider: (id: string) => Provider | undefined;
  registerNativeProvider: (provider: Provider) => void;
}

/**
 * Dependencies for ApertureRuntime.sync()
 */
export interface SyncDeps {
  native?: NativeProviderDeps;
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
