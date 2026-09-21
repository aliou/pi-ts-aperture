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
  TranscriptContext,
} from "@earendil-works/pi-ai";

export type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  Provider,
  SimpleStreamOptions,
  TranscriptContext,
};

/**
 * Dependencies for ApertureRuntime.sync()
 */
export interface SyncDeps {
  getProvider: (id: string) => Provider | undefined;
  registerNativeProvider: (provider: Provider) => void;
  getModels: () => Model<Api>[];
  notify?: (msg: string, type: "warning" | "info") => void;
  /**
   * True when the extension instance that supplied these deps was
   * invalidated (session replacement or reload). Checked after every await
   * before touching ctx-bound deps again; the replacement session's
   * `session_start` re-runs the sync with a fresh ctx, so abandoning loses
   * nothing.
   */
  isStale?: () => boolean;
}

/**
 * Dependencies for ApertureRuntime.checkMissingModels()
 */
export interface CheckDeps {
  getModels: () => Model<Api>[];
  notify: (msg: string, type: "warning" | "info") => void;
  /** See SyncDeps.isStale. */
  isStale?: () => boolean;
}
