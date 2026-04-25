/**
 * aperture:setup -- interactive wizard for configuring Aperture.
 *
 * Steps:
 * 1. URL input (health check runs inline on Enter, auto-advances on success)
 * 2. Provider selection with per-provider "verify models" sub-option
 */

import {
  FuzzyMultiSelector,
  type FuzzyMultiSelectorItem,
  getSettingsTheme,
  Wizard,
  type WizardStepContext,
} from "@aliou/pi-utils-settings";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../../lib/config";
import { UrlStep } from "./setup-wizard";

export function registerSetupCommand(
  pi: ExtensionAPI,
  onSync: (ctx: ExtensionContext) => void,
): void {
  pi.registerCommand("aperture:setup", {
    description: "Configure Tailscale Aperture integration",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "aperture:setup requires an interactive terminal",
          "error",
        );
        return;
      }

      const config = configLoader.getConfig();
      const checkGatewayProviders = config.checkGatewayModels ?? [];

      const knownProviders = Array.from(
        new Set(ctx.modelRegistry.getAll().map((model) => model.provider)),
      ).sort((a, b) => a.localeCompare(b));

      let baseUrl = config.baseUrl;

      const providerItems: FuzzyMultiSelectorItem[] = knownProviders.map(
        (p) => ({
          label: p,
          checked: config.providers.includes(p),
          subOptions: [
            {
              label: "verify models on gateway",
              description:
                "Warn at startup if this provider's models are missing from the Aperture gateway",
              checked: checkGatewayProviders.includes(p),
            },
          ],
        }),
      );

      const confirmed = await ctx.ui.custom<boolean | undefined>(
        (tui, theme, _kb, done) => {
          const settingsTheme = getSettingsTheme(theme);

          return new Wizard({
            title: "Aperture Setup",
            theme: settingsTheme,
            minContentHeight: 16,
            steps: [
              {
                label: "URL",
                build: (wCtx: WizardStepContext) =>
                  new UrlStep(settingsTheme, tui, baseUrl, wCtx, (url) => {
                    baseUrl = url;
                  }),
              },
              {
                label: "Providers",
                build: (wCtx: WizardStepContext) => {
                  wCtx.markComplete();
                  return new FuzzyMultiSelector({
                    label: "Providers to route through Aperture",
                    items: providerItems,
                    theme: settingsTheme,
                    showHints: false,
                    showCount: false,
                    maxVisible: 7,
                  });
                },
              },
            ],
            onComplete: () => done(true),
            onCancel: () => done(undefined),
          });
        },
      );

      if (!confirmed) return;

      const providers = providerItems
        .filter((i) => i.checked)
        .map((i) => i.label);

      const checkGatewayModels = providerItems
        .filter((i) => i.checked && i.subOptions?.[0]?.checked)
        .map((i) => i.label);

      await configLoader.save("global", {
        baseUrl,
        providers,
        checkGatewayModels,
        apertureProvider: config.apertureProvider,
      });
      onSync(ctx);
      ctx.ui.notify(
        `Aperture configured: ${providers.length} provider(s) via ${baseUrl}`,
        "info",
      );
    },
  });
}
