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

export type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
};

/**
 * Dependencies for ApertureRuntime.sync()
 */
export interface SyncDeps {
  getProvider: (id: string) => Provider | undefined;
  registerNativeProvider: (provider: Provider) => void;
  getModels: () => Model<Api>[];
}

/**
 * Dependencies for ApertureRuntime.checkMissingModels()
 */
export interface CheckDeps {
  getModels: () => Model<Api>[];
  notify: (msg: string, type: "warning" | "info") => void;
}
