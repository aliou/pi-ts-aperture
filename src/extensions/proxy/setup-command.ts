/**
 * aperture:onboarding -- first-time setup wizard for configuring Aperture.
 *
 * Only registered when onboarding has not been completed yet.
 * After completion, the command is no longer available.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { configLoader } from "../../lib/config";
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

      const knownProviders = Array.from(
        new Set(ctx.modelRegistry.getAll().map((model) => model.provider)),
      ).sort((a, b) => a.localeCompare(b));

      const result = await ctx.ui.custom<OnboardingResult>(
        (tui, theme, _kb, done) =>
          createOnboardingWizard(
            theme,
            tui,
            done,
            knownProviders,
            globalConfig,
          ),
        { overlay: true },
      );

      if (!result.completed) {
        ctx.ui.notify("[aperture] onboarding cancelled.", "warning");
        return;
      }

      const onboarded = buildOnboardedConfig(
        result.baseUrl,
        result.mode,
        result.upstreamProviders,
        result.dedicatedProviders,
      );
      await configLoader.save("global", onboarded);
      await configLoader.load();

      for (let i = 2; i > 0; i--) {
        ctx.ui.notify(
          `[aperture] onboarding completed. Reloading in ${i}s...`,
          "info",
        );
        await new Promise((r) => setTimeout(r, 1000));
      }
      await ctx.reload();
    },
  });
}
