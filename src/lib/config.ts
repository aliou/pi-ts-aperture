/**
 * Configuration schema and loader for the Aperture extension.
 *
 * ApertureConfig is the user-facing schema (all fields optional).
 * ResolvedConfig is the internal schema (all fields required, defaults applied).
 *
 * Two modes:
 * - "proxy": reroute selected existing Pi providers through Aperture
 * - "dedicated": register a standalone "aperture" provider whose models come from Aperture
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";
import { legacyMigration } from "./migration";

export type ApertureMode = "proxy" | "dedicated";

export interface ProxiedProviderConfig {
  id: string;
  shouldCheckGatewayModels?: boolean;
}

export interface DedicatedProviderConfig {
  id: string;
  name?: string;
  enabled: boolean;
}

/** Cached model from gateway, persisted for fast registration on resume. */
export interface CachedModel {
  id: string;
  providerId: string;
  providerName?: string;
  pricing?: {
    input?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    output?: string;
  };
}

export interface ApertureConfig {
  baseUrl?: string;
  mode?: ApertureMode;
  onboardingDone?: boolean;
  onboarding?: {
    enabled?: boolean;
  };
  proxy?: {
    upstreamProviders?: ProxiedProviderConfig[];
  };
  dedicated?: {
    providers?: DedicatedProviderConfig[];
    cachedModels?: CachedModel[];
  };

  // --- Legacy fields (pre-0.6.0, migrated on load) ---
  providers?: string[];
  checkGatewayModels?: string[];
  apertureProvider?: boolean;
}

export interface ResolvedConfig {
  baseUrl: string;
  mode: ApertureMode;
  onboardingDone: boolean;
  onboarding: {
    enabled: boolean;
  };
  proxy: {
    upstreamProviders: Required<ProxiedProviderConfig>[];
  };
  dedicated: {
    providers: DedicatedProviderConfig[];
    cachedModels: CachedModel[];
  };
}

const DEFAULT_CONFIG: ResolvedConfig = {
  baseUrl: "",
  mode: "dedicated",
  onboardingDone: false,
  onboarding: {
    enabled: true,
  },
  proxy: {
    upstreamProviders: [],
  },
  dedicated: {
    providers: [],
    cachedModels: [],
  },
};

export const configLoader = new ConfigLoader<ApertureConfig, ResolvedConfig>(
  "aperture",
  DEFAULT_CONFIG,
  {
    scopes: ["global"],
    migrations: [legacyMigration],
  },
);
