/**
 * Plain data types used by core functions.
 * Model is re-exported from @mariozechner/pi-ai for internal use.
 */
import type { Api, Model } from "@mariozechner/pi-ai";

export type ApertureMode = "override" | "provider";

/** Name used when registering Aperture itself as a first-class provider. */
export const APERTURE_PROVIDER_NAME = "aperture";

export interface ApertureConfig {
  mode: ApertureMode;
  baseUrl: string;
  providers: string[];
  checkGatewayModels: string[];
}

export interface ProviderRegistration {
  provider: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  api: string;
  models: Model<Api>[];
}

// Re-export Model for use in other core files
export type { Model, Api };

export interface ApplyPlan {
  registrations: ProviderRegistration[];
  missingModels: string[];
}

export interface ConfigChangePlan {
  removedProviders: string[];
  shouldRefreshModel: boolean;
}

/**
 * Minimal shape of a single entry in the OpenAI-compatible /v1/models
 * response. Aperture's gateway response is treated as best-effort: only `id`
 * is guaranteed; every other field is optional and is copied through when
 * present. Fields the gateway does not emit are filled with safe defaults
 * downstream (see `APERTURE_MODEL_DEFAULTS` in `core/plan.ts`).
 *
 * `input` is kept loose (`string[]`) here to stay forward-compatible with
 * future modality names; the builder downstream sanitizes it to the
 * `("text" | "image")[]` literal required by `Model.input`.
 *
 * Wire-only pricing fields that have no slot in Pi's `Model.cost` shape
 * (`image`, `web_search`, `internal_reasoning`) are not represented here --
 * the health-lib parser drops them explicitly because `Model<TApi>.cost` is
 * strictly `{ input, output, cacheRead, cacheWrite }` and `calculateCost`
 * only sums those four.
 */
export interface GatewayModelInfo {
  id: string;
  /** Display name if the gateway provides one. */
  name?: string;
  /** Context window in tokens, if advertised. */
  contextWindow?: number;
  /** Max output tokens, if advertised. */
  maxTokens?: number;
  /** Pricing per-1M tokens, if advertised. */
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  /** Raw input modalities list, if advertised (sanitized downstream). */
  input?: string[];
  /** Whether the model is a reasoning model, if advertised. */
  reasoning?: boolean;
  /**
   * Wire protocol. Defaults to "openai-completions" because Aperture exposes
   * an OpenAI-compatible surface. Can be overridden per-model by the gateway.
   */
  api?: string;
}
