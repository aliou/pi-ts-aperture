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
}

export interface ResolvedConfig {
  baseUrl: string;
  providers: string[];
}

const DEFAULT_CONFIG: ResolvedConfig = {
  baseUrl: "",
  providers: [],
};

export const configLoader = new ConfigLoader<ApertureConfig, ResolvedConfig>(
  "aperture",
  DEFAULT_CONFIG,
  { scopes: ["global"] },
);
