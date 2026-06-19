import type { ResolvedConfig } from "./types";

export const DEFAULT_CONFIG: ResolvedConfig = {
  baseUrl: "",
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
  features: {
    connectors: false,
  },
};
