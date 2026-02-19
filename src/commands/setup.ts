/**
 * aperture:setup -- interactive wizard for configuring Aperture.
 *
 * Steps:
 * 1. Ask for Aperture base URL (Input)
 * 2. Select providers to route through Aperture (FuzzySelector, multi-select loop)
 * 3. Save config and register providers
 */

import { FuzzySelector } from "@aliou/pi-utils-settings";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { Input, Key, matchesKey } from "@mariozechner/pi-tui";
import { configLoader } from "../config";
import { checkApertureHealth } from "../lib/health";

function normalizeUrl(url: string): string {
  let result = url.trim();
  if (!result) return result;
  if (!result.startsWith("http://") && !result.startsWith("https://")) {
    result = `http://${result}`;
  }
  return result.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Shows a spinner while verifying the Aperture URL is reachable.
 * Kicks off the health check on construction and resolves done(boolean)
 * when the check completes.
 */
class HealthCheckSpinner implements Component {
  private theme: ReturnType<typeof getSettingsListTheme>;
  private url: string;
  private tui: TUI;
  // true = healthy, false = failed (retry), undefined = cancelled
  private done: (result: boolean | undefined) => void;
  private frame = 0;
  private timer: ReturnType<typeof setInterval>;
  private result: { ok: boolean; error?: string } | null = null;

  constructor(
    theme: ReturnType<typeof getSettingsListTheme>,
    url: string,
    tui: TUI,
    done: (result: boolean | undefined) => void,
  ) {
    this.theme = theme;
    this.url = url;
    this.tui = tui;
    this.done = done;

    // Animate spinner at ~80ms per frame.
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      this.tui.requestRender();
    }, 80);

    // Fire the check.
    checkApertureHealth(url).then((res) => {
      clearInterval(this.timer);
      this.result = res;
      this.tui.requestRender();

      // On success, auto-advance after a brief pause.
      // On failure, wait for user input (see handleInput).
      if (res.ok) {
        setTimeout(() => this.done(true), 600);
      }
    });
  }

  render(_width: number): string[] {
    const lines: string[] = [];
    lines.push(this.theme.label(" Aperture Setup", true));
    lines.push("");

    if (!this.result) {
      const spinner = SPINNER_FRAMES[this.frame];
      lines.push(
        this.theme.hint(`  ${spinner} Checking connection to ${this.url}...`),
      );
    } else if (this.result.ok) {
      lines.push(this.theme.hint(`  Connected to ${this.url}`));
    } else {
      lines.push(
        this.theme.hint(`  Could not reach ${this.url}: ${this.result.error}`),
      );
      lines.push("");
      lines.push(
        this.theme.hint(
          "  Make sure the URL is correct and you are connected to the tailnet.",
        ),
      );
      lines.push("");
      lines.push(this.theme.hint("  Enter: try another URL · Esc: cancel"));
    }

    lines.push("");
    return lines;
  }

  invalidate() {}

  handleInput(data: string) {
    // Only handle input after a failed check.
    if (!this.result || this.result.ok) return;

    if (matchesKey(data, Key.enter)) {
      this.done(false); // retry
    } else if (matchesKey(data, Key.escape)) {
      this.done(undefined); // cancel wizard
    }
  }

  dispose() {
    clearInterval(this.timer);
  }
}

/**
 * Simple input prompt component for the base URL step.
 */
class UrlPrompt implements Component {
  private input: Input;
  private done: (value: string | undefined) => void;
  private theme: ReturnType<typeof getSettingsListTheme>;
  private placeholder = "ai.pango-lin.ts.net";

  constructor(
    theme: ReturnType<typeof getSettingsListTheme>,
    currentValue: string,
    done: (value: string | undefined) => void,
  ) {
    this.theme = theme;
    this.done = done;
    this.input = new Input();
    if (currentValue) {
      this.input.setValue(currentValue);
    }

    this.input.onSubmit = () => {
      const value = this.input.getValue().trim();
      if (!value) return;
      this.done(normalizeUrl(value));
    };
    this.input.onEscape = () => {
      this.done(undefined);
    };
  }

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.theme.label(" Aperture Setup", true));
    lines.push("");
    lines.push(
      this.theme.hint(`  Aperture base URL (e.g. ${this.placeholder}):`),
    );
    lines.push(`  ${this.input.render(width - 4).join("")}`);
    lines.push("");
    lines.push(this.theme.hint("  Enter: confirm · Esc: cancel"));
    return lines;
  }

  invalidate() {}

  handleInput(data: string) {
    this.input.handleInput(data);
  }
}

/**
 * Provider multi-select component. Uses FuzzySelector for search,
 * tracks selected providers, and lets the user confirm with Ctrl+S.
 */
class ProviderMultiSelect implements Component {
  private allProviders: string[];
  private selected: Set<string>;
  private theme: ReturnType<typeof getSettingsListTheme>;
  private done: (value: string[] | undefined) => void;
  private fuzzy: FuzzySelector;

  constructor(
    theme: ReturnType<typeof getSettingsListTheme>,
    providers: string[],
    preselected: string[],
    done: (value: string[] | undefined) => void,
  ) {
    this.allProviders = providers;
    this.selected = new Set(preselected);
    this.theme = theme;
    this.done = done;

    this.fuzzy = new FuzzySelector({
      label: "Select providers (Enter to toggle, Ctrl+S to confirm)",
      items: this.allProviders,
      theme,
      onSelect: (value) => {
        if (this.selected.has(value)) {
          this.selected.delete(value);
        } else {
          this.selected.add(value);
        }
      },
      onDone: () => {
        this.done(undefined);
      },
    });
  }

  render(width: number): string[] {
    const lines = this.fuzzy.render(width);

    // Append selected providers summary
    if (this.selected.size > 0) {
      lines.push("");
      lines.push(this.theme.hint(`  Selected (${this.selected.size}):`));
      for (const p of this.selected) {
        lines.push(`    ${this.theme.value(p, false)}`);
      }
    }

    // Replace the hint line from FuzzySelector
    const hintIndex = lines.findIndex((l) => l.includes("Type to search"));
    if (hintIndex !== -1) {
      lines[hintIndex] = this.theme.hint(
        "  Type to search · Enter: toggle · Ctrl+S: confirm · Esc: cancel",
      );
    }

    return lines;
  }

  invalidate() {
    this.fuzzy.invalidate();
  }

  handleInput(data: string) {
    if (matchesKey(data, Key.ctrl("s"))) {
      this.done([...this.selected]);
      return;
    }
    this.fuzzy.handleInput(data);
  }
}

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
      const settingsTheme = getSettingsListTheme();

      // Step 1: base URL + health check loop.
      // On failure, loop back to the URL prompt so the user can retry.
      let baseUrl: string | undefined;
      while (true) {
        baseUrl = await ctx.ui.custom<string | undefined>(
          (_tui, _theme, _kb, done) => {
            return new UrlPrompt(
              settingsTheme,
              baseUrl ?? config.baseUrl,
              done,
            );
          },
        );

        if (!baseUrl) return;
        const urlToCheck = baseUrl;

        const result = await ctx.ui.custom<boolean | undefined>(
          (tui, _theme, _kb, done) => {
            return new HealthCheckSpinner(settingsTheme, urlToCheck, tui, done);
          },
        );

        if (result === true) break; // healthy, proceed
        if (result === undefined) return; // cancelled
      }

      // Step 2: select providers
      // Use model registry so custom/extension providers are included.
      const knownProviders = Array.from(
        new Set(ctx.modelRegistry.getAll().map((model) => model.provider)),
      ).sort((a, b) => a.localeCompare(b));

      const providers = await ctx.ui.custom<string[] | undefined>(
        (_tui, _theme, _kb, done) => {
          return new ProviderMultiSelect(
            settingsTheme,
            knownProviders,
            config.providers,
            done,
          );
        },
      );

      if (!providers) return;

      // Step 3: save and register
      await configLoader.save("global", { baseUrl, providers });
      onConfigChange(ctx);
      ctx.ui.notify(
        `Aperture configured: ${providers.length} provider(s) via ${baseUrl}`,
        "info",
      );
    },
  });
}
