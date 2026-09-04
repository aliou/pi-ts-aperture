import type { ResolvedConfig } from "./types";

export const DEFAULT_CONFIG: ResolvedConfig = {
  baseUrl: "",
  onboardingDone: false,
  shouldSendProvenanceHeaders: true,
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
