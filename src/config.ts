/**
 * Configuration schema and loader for the Aperture extension.
 *
 * ApertureConfig is the user-facing schema (all fields optional).
 * ResolvedConfig is the internal schema (all fields required, defaults applied).
 *
 * Two operating modes:
 * - "override": re-registers existing providers (openai, anthropic, ...) so
 *   their requests are routed through the Aperture gateway. Model metadata is
 *   inherited from the upstream provider registration.
 * - "provider": registers a single new provider named "aperture" whose model
 *   list is discovered from GET <baseUrl>/v1/models on the gateway. Model
 *   metadata comes exclusively from the gateway response.
 */

import { ConfigLoader } from "@aliou/pi-utils-settings";

export type ApertureMode = "override" | "provider";

export interface ApertureConfig {
  mode?: ApertureMode;
  baseUrl?: string;
  providers?: string[];
  checkGatewayModels?: string[];
}

export interface ResolvedConfig {
  mode: ApertureMode;
  baseUrl: string;
  providers: string[];
  checkGatewayModels: string[];
}

const DEFAULT_CONFIG: ResolvedConfig = {
  mode: "override",
  baseUrl: "",
  providers: [],
  checkGatewayModels: [],
};

export const configLoader = new ConfigLoader<ApertureConfig, ResolvedConfig>(
  "aperture",
  DEFAULT_CONFIG,
  { scopes: ["global"] },
);
