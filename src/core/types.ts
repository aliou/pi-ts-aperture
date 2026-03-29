/**
 * Plain data types used by core functions. No Pi imports.
 */

export interface ModelInfo {
  id: string;
  provider: string;
  api?: string;
  headers?: Record<string, string>;
}

export interface ApertureConfig {
  baseUrl: string;
  providers: string[];
}

export interface ProviderRegistration {
  provider: string;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
  api: string;
  models: ModelInfo[];
}

export interface ApplyPlan {
  registrations: ProviderRegistration[];
  missingModels: string[];
}

export interface ConfigChangePlan {
  removedProviders: string[];
  shouldRefreshModel: boolean;
}
