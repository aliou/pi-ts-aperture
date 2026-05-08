/**
 * aperture:setup -- onboarding wizard for configuring Aperture.
 *
 * If onboarding is already completed, notifies the user to use
 * /aperture:settings instead. Otherwise, shows the interactive
 * setup wizard.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../../lib/config";
import {
  buildOnboardedConfig,
  createOnboardingWizard,
  isOnboardingPending,
  type OnboardingResult,
} from "./onboarding";

export function registerSetupCommand(
  pi: ExtensionAPI,
  onSync: (ctx: ExtensionContext) => void,
): void {
  pi.registerCommand("aperture:setup", {
    description: "Configure Tailscale Aperture integration",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "aperture:setup requires an interactive terminal",
          "error",
        );
        return;
      }

      const globalConfig = configLoader.getRawConfig("global");
      if (!isOnboardingPending(globalConfig)) {
        ctx.ui.notify(
          "[aperture] setup already completed. Use /aperture:settings to update.",
          "info",
        );
        return;
      }

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
        ctx.ui.notify("[aperture] setup cancelled.", "warning");
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

      if (result.mode === "proxy") {
        onSync(ctx);
        ctx.ui.notify("[aperture] setup completed.", "info");
      } else {
        for (let i = 2; i > 0; i--) {
          ctx.ui.notify(
            `[aperture] setup completed. Reloading in ${i}s...`,
            "info",
          );
          await new Promise((r) => setTimeout(r, 1000));
        }
        await ctx.reload();
      }
    },
  });
}
