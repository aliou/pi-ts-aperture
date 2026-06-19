import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { configLoader } from "../../../src/shared/config/loader";
import {
  buildOnboardedConfig,
  createOnboardingWizard,
  type OnboardingResult,
} from "./onboarding";

export function registerOnboardingCommand(pi: ExtensionAPI): void {
  pi.registerCommand("aperture:onboarding", {
    description: "First-time setup for Tailscale Aperture integration",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "[aperture] onboarding requires an interactive terminal",
          "error",
        );
        return;
      }

      const globalConfig = configLoader.getRawConfig("global");
      const knownModels = ctx.modelRegistry.getAll();

      const result = await ctx.ui.custom<OnboardingResult>(
        (tui, theme, _kb, done) =>
          createOnboardingWizard(theme, tui, done, knownModels, globalConfig),
        { overlay: true },
      );

      if (!result.completed) {
        ctx.ui.notify("[aperture] onboarding cancelled.", "warning");
        return;
      }

      await configLoader.save(
        "global",
        buildOnboardedConfig(
          result.baseUrl,
          result.proxyEnabled,
          result.dedicatedEnabled,
          result.upstreamProviders,
          result.dedicatedProviders,
        ),
      );
      await configLoader.load();
      ctx.ui.notify("[aperture] onboarding completed. Reloading...", "info");
      await ctx.reload();
    },
  });
}
