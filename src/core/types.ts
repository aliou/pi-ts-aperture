/**
 * Plain data types used by core functions.
 * Model is re-exported from @mariozechner/pi-ai for internal use.
 */
import type { Api, Model } from "@mariozechner/pi-ai";

export interface ApertureConfig {
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
