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

export interface ApertureConfig {
  baseUrl?: string;
  mode?: ApertureMode;
  onboardingDone?: boolean;
  proxy?: {
    upstreamProviders?: ProxiedProviderConfig[];
  };
  dedicated?: {
    providers?: DedicatedProviderConfig[];
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
  proxy: {
    upstreamProviders: Required<ProxiedProviderConfig>[];
  };
  dedicated: {
    providers: DedicatedProviderConfig[];
  };
}

const DEFAULT_CONFIG: ResolvedConfig = {
  baseUrl: "",
  mode: "dedicated",
  onboardingDone: false,
  proxy: {
    upstreamProviders: [],
  },
  dedicated: {
    providers: [],
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
