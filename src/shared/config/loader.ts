import { ConfigLoader } from "@aliou/pi-utils-settings";
import { DEFAULT_CONFIG } from "./defaults";
import { migrations } from "./migration";
import type { ApertureConfig, ResolvedConfig } from "./types";

export const configLoader = new ConfigLoader<ApertureConfig, ResolvedConfig>(
  "aperture",
  DEFAULT_CONFIG,
  {
    scopes: ["global"],
    migrations,
  },
);

export type {
  ApertureConfig,
  ApertureMode,
  ConnectorsConfig,
  DedicatedProviderConfig,
  ProxiedProviderConfig,
  ResolvedConfig,
} from "./types";
