/**
 * aperture:setup -- interactive wizard for configuring Aperture.
 *
 * Steps:
 * 1. URL input (health check runs inline on Enter, auto-advances on success)
 * 2. Mode selection (override | provider)
 * 3. Provider selection with per-provider "verify models" sub-option
 *    (skipped in provider mode -- the gateway is the source of truth)
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
import type { ApertureMode } from "../config";
import { configLoader } from "../config";
import { normalizeInputUrl } from "../core";
import { checkApertureHealth } from "../lib/health";

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
// Step 2: Mode selection
// ---------------------------------------------------------------------------

interface ModeOption {
  value: ApertureMode;
  label: string;
  description: string;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    value: "override",
    label: "override",
    description:
      "Route existing providers (openai, anthropic, ...) through the gateway.",
  },
  {
    value: "provider",
    label: "provider",
    description:
      "Register 'aperture' as a new provider; models come from /v1/models.",
  },
];

class ModeStep implements Component {
  private theme: SettingsTheme;
  private tui: TUI;
  private wizCtx: WizardStepContext;
  private onMode: (mode: ApertureMode) => void;
  private index: number;

  constructor(
    theme: SettingsTheme,
    tui: TUI,
    current: ApertureMode,
    wizCtx: WizardStepContext,
    onMode: (mode: ApertureMode) => void,
  ) {
    this.theme = theme;
    this.tui = tui;
    this.wizCtx = wizCtx;
    this.onMode = onMode;
    this.index = Math.max(
      0,
      MODE_OPTIONS.findIndex((o) => o.value === current),
    );
    // Any selection is valid so the step is complete from the start.
    this.onMode(MODE_OPTIONS[this.index].value);
    this.wizCtx.markComplete();
  }

  render(_width: number): string[] {
    const lines: string[] = [];
    lines.push(this.theme.hint("  Select integration mode:"));
    lines.push("");
    for (let i = 0; i < MODE_OPTIONS.length; i++) {
      const opt = MODE_OPTIONS[i];
      const marker = i === this.index ? "●" : "○";
      const label = `${marker} ${opt.label}`;
      const line = i === this.index ? label : this.theme.hint(label);
      lines.push(`  ${line}`);
      lines.push(`    ${this.theme.hint(opt.description)}`);
    }
    lines.push("");
    lines.push(this.theme.hint("  ↑/↓ to change, Enter to continue."));
    return lines;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (data === "\x1b[A") {
      // up arrow
      this.index = (this.index - 1 + MODE_OPTIONS.length) % MODE_OPTIONS.length;
      this.onMode(MODE_OPTIONS[this.index].value);
      this.tui.requestRender();
    } else if (data === "\x1b[B") {
      // down arrow
      this.index = (this.index + 1) % MODE_OPTIONS.length;
      this.onMode(MODE_OPTIONS[this.index].value);
      this.tui.requestRender();
    } else if (data === "\r" || data === "\n") {
      this.onMode(MODE_OPTIONS[this.index].value);
      this.wizCtx.goNext();
    }
  }

  dispose(): void {}
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerSetupCommand(
  pi: ExtensionAPI,
  onConfigChange: (ctx: ExtensionContext) => void,
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
      let mode: ApertureMode = config.mode;

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
                label: "Mode",
                build: (wCtx: WizardStepContext) =>
                  new ModeStep(settingsTheme, tui, mode, wCtx, (m) => {
                    mode = m;
                  }),
              },
              {
                label: "Providers",
                build: (wCtx: WizardStepContext) => {
                  wCtx.markComplete();
                  // Provider mode: nothing to pick here -- the gateway is the
                  // source of truth. Show a tiny informational component.
                  if (mode === "provider") {
                    return new ProviderModeInfo(settingsTheme);
                  }
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

      const providers =
        mode === "override"
          ? providerItems.filter((i) => i.checked).map((i) => i.label)
          : [];

      const checkGatewayModels =
        mode === "override"
          ? providerItems
              .filter((i) => i.checked && i.subOptions?.[0]?.checked)
              .map((i) => i.label)
          : [];

      await configLoader.save("global", {
        mode,
        baseUrl,
        providers,
        checkGatewayModels,
      });
      onConfigChange(ctx);

      const summary =
        mode === "provider"
          ? `Aperture configured as provider via ${baseUrl}`
          : `Aperture configured: ${providers.length} provider(s) via ${baseUrl}`;
      ctx.ui.notify(summary, "info");
    },
  });
}

// ---------------------------------------------------------------------------
// Provider-mode informational step
// ---------------------------------------------------------------------------

class ProviderModeInfo implements Component {
  constructor(private theme: SettingsTheme) {}

  render(_width: number): string[] {
    return [
      "",
      this.theme.hint(
        "  Provider mode: an 'aperture' provider will be registered,",
      ),
      this.theme.hint(
        "  with models discovered from GET <baseUrl>/v1/models on the gateway.",
      ),
      "",
      this.theme.hint("  Press Enter to confirm."),
    ];
  }

  invalidate(): void {}
  handleInput(_data: string): void {}
  dispose(): void {}
}
