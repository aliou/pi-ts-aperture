import type { ResolvedConfig } from "./types";

export const DEFAULT_CONFIG: ResolvedConfig = {
  baseUrl: "",
  openaiRoute: "v1",
  onboardingDone: false,
  onboarding: {
    enabled: true,
  },
  proxy: {
    enabled: false,
    upstreamProviders: [],
  },
  dedicated: {
    enabled: true,
    providers: [],
  },
  connectors: {
    enabled: false,
    pinnedTools: [],
    discoveryTools: true,
  },
};
