/**
 * Internal types for Aperture extension.
 */

import type { Api, Model } from "@mariozechner/pi-ai";

export type { Model, Api };

/**
 * Dependencies for ApertureRuntime.sync()
 */
export interface SyncDeps {
  registerProvider: (
    name: string,
    config: {
      baseUrl: string;
      apiKey: string;
      headers: Record<string, string>;
      api: string;
      models: Model<Api>[];
    },
  ) => void;
  getModels: () => Model<Api>[];
}

/**
 * Dependencies for ApertureRuntime.checkMissingModels()
 */
export interface CheckDeps {
  getModels: () => Model<Api>[];
  notify: (msg: string, type: "warning" | "info") => void;
}

/**
 * Headers for provider registration.
 */
export interface ProviderHeaders {
  Referer: string;
  "X-Title": string;
}
