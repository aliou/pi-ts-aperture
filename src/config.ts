/**
 * Configuration schema and loader for the Aperture extension.
 *
 * ApertureConfig is the user-facing schema (all fields optional).
 * ResolvedConfig is the internal schema (all fields required, defaults applied).
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";

export interface ApertureConfig {
  baseUrl?: string;
  providers?: string[];
  checkGatewayModels?: string[];
}

export interface ResolvedConfig {
  baseUrl: string;
  providers: string[];
  checkGatewayModels: string[];
}

const DEFAULT_CONFIG: ResolvedConfig = {
  baseUrl: "",
  providers: [],
  checkGatewayModels: [],
};

export const configLoader = new ConfigLoader<ApertureConfig, ResolvedConfig>(
  "aperture",
  DEFAULT_CONFIG,
  { scopes: ["global"] },
);
