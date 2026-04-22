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
  type SettingsTheme,
  Wizard,
  type WizardStepContext,
} from "@aliou/pi-utils-settings";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { Input } from "@mariozechner/pi-tui";
import { configLoader } from "../lib/config";
import { checkApertureHealth } from "../lib/gateway";
import { normalizeInputUrl } from "../lib/url";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ---------------------------------------------------------------------------
// Step 1: URL input with inline health check
// ---------------------------------------------------------------------------

class UrlStep implements Component {
  private input: Input;
  private theme: SettingsTheme;
  private tui: TUI;
  private wizCtx: WizardStepContext;
  private onUrl: (url: string) => void;
  private readonly placeholder = "ai.pango-lin.ts.net";

  private state: "idle" | "checking" | "ok" | "error" = "idle";
  private errorMessage = "";
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    theme: SettingsTheme,
    tui: TUI,
    currentValue: string,
    wizCtx: WizardStepContext,
    onUrl: (url: string) => void,
  ) {
    this.theme = theme;
    this.tui = tui;
    this.wizCtx = wizCtx;
    this.onUrl = onUrl;
    this.input = new Input();
    if (currentValue) {
      this.input.setValue(currentValue);
    }
    this.input.onSubmit = () => this.submit();
  }

  private submit(): void {
    const value = this.input.getValue().trim();
    if (!value || this.state === "checking") return;

    const url = normalizeInputUrl(value);
    this.state = "checking";
    this.frame = 0;

    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      this.tui.requestRender();
    }, 80);

    checkApertureHealth(url).then((res) => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;

      if (res.ok) {
        this.state = "ok";
        this.onUrl(url);
        this.wizCtx.markComplete();
        this.tui.requestRender();
        setTimeout(() => this.wizCtx.goNext(), 400);
      } else {
        this.state = "error";
        this.errorMessage = res.error ?? "unknown error";
        this.tui.requestRender();
      }
    });
  }

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(
      this.theme.hint(`  Aperture base URL (e.g. ${this.placeholder}):`),
    );
    lines.push(`  ${this.input.render(width - 4).join("")}`);
    lines.push("");

    if (this.state === "checking") {
      const spinner = SPINNER_FRAMES[this.frame];
      lines.push(this.theme.hint(`  ${spinner} Checking connection...`));
    } else if (this.state === "ok") {
      lines.push(this.theme.hint("  Connected."));
    } else if (this.state === "error") {
      lines.push(this.theme.hint(`  Could not connect: ${this.errorMessage}`));
      lines.push(this.theme.hint("  Fix the URL and press Enter to retry."));
    }

    return lines;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.state === "checking") return;
    this.state = "idle";
    this.input.handleInput(data);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
  }
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

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
      });
      onSync(ctx);
      ctx.ui.notify(
        `Aperture configured: ${providers.length} provider(s) via ${baseUrl}`,
        "info",
      );
    },
  });
}
