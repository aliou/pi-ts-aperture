/**
 * aperture:setup -- interactive wizard for configuring Aperture.
 *
 * Steps:
 * 1. Ask for Aperture base URL (Input)
 * 2. Select providers to route through Aperture (FuzzySelector, multi-select loop)
 * 3. Save config and register providers
 */

import { FuzzySelector } from "@aliou/pi-utils-settings";
import { getProviders } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getSettingsListTheme } from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Input, Key, matchesKey } from "@mariozechner/pi-tui";
import { configLoader } from "../config";

function normalizeUrl(url: string): string {
  let result = url.trim();
  if (!result) return result;
  if (!result.startsWith("http://") && !result.startsWith("https://")) {
    result = `http://${result}`;
  }
  return result.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
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
  onConfigChange: () => void,
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

      // Step 1: base URL
      const baseUrl = await ctx.ui.custom<string | undefined>(
        (_tui, _theme, _kb, done) => {
          return new UrlPrompt(settingsTheme, config.baseUrl, done);
        },
      );

      if (!baseUrl) return;

      // Step 2: select providers
      const knownProviders = getProviders();
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
      onConfigChange();
      ctx.ui.notify(
        `Aperture configured: ${providers.length} provider(s) via ${baseUrl}`,
        "info",
      );
    },
  });
}
