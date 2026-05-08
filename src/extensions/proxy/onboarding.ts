/**
 * Onboarding wizard for Aperture extension.
 *
 * Steps:
 * 1. Welcome -- explain Aperture and the two modes
 * 2. URL -- input with inline health check
 * 3. Mode -- choose dedicated or proxy
 * 4. Proxy providers -- only if proxy mode, select providers + gateway check
 * 5. Recap -- summary before saving
 */

import {
  getSettingsTheme,
  type SettingsTheme,
  Wizard,
  type WizardStepContext,
} from "@aliou/pi-utils-settings";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { getMarkdownTheme } from "@mariozechner/pi-coding-agent";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { Box, Key, Markdown, matchesKey, Text } from "@mariozechner/pi-tui";
import type { ApertureConfig, ApertureMode } from "../../lib/config";
import { UrlStep } from "./setup-wizard";

// --- Onboarding state ---

export interface OnboardingResult {
  completed: boolean;
  baseUrl: string;
  mode: ApertureMode;
  upstreamProviders: { id: string; shouldCheckGatewayModels: boolean }[];
}

interface OnboardingState {
  baseUrl: string;
  mode: ApertureMode | null;
  upstreamProviders: { id: string; shouldCheckGatewayModels: boolean }[];
}

// --- Steps ---

class IntroStep implements Component {
  private readonly introText = new Text("", 2, 0);

  constructor(private readonly onNext: () => void) {}

  invalidate() {
    this.introText.invalidate();
  }

  render(width: number): string[] {
    this.introText.setText(
      'Aperture lets you route LLM traffic through your Tailscale tailnet.\n\nYou can use it two ways:\n\n- Dedicated provider: a standalone "aperture" provider with all models from your gateway\n- Proxy: reroute existing Pi providers (e.g. anthropic, openai) through Aperture\n\nYou can change these settings later in /aperture:settings.',
    );

    return [
      "  Welcome to Aperture",
      "",
      ...this.introText.render(Math.max(1, width)),
    ];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      this.onNext();
    }
  }
}

class ModeStep implements Component {
  private selectedIndex = 0;
  private readonly settingsTheme: SettingsTheme;

  constructor(
    private readonly theme: Theme,
    private readonly state: OnboardingState,
    private readonly wizCtx: WizardStepContext,
  ) {
    this.settingsTheme = getSettingsTheme(theme);
  }

  invalidate() {}

  render(width: number): string[] {
    const options = ["Dedicated Aperture provider", "Proxy existing providers"];
    const explanations = [
      [
        "Register a standalone `aperture` provider whose model list comes directly from your Aperture gateway.",
        "",
        "- All gateway models appear under one provider",
        "- Uses `openai-completions` API for all models",
        "- Recommended for most setups",
      ].join("\n"),
      [
        "Reroute existing Pi providers (anthropic, openai, etc.) through Aperture, keeping their original model definitions.",
        "",
        "- Each provider keeps its own model list and settings",
        "- Only the base URL and API key are overridden",
        "- Useful when you want to keep per-provider model config",
      ].join("\n"),
    ];

    const lines: string[] = ["  How do you want to use Aperture?", ""];

    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (!option) continue;
      const selected = i === this.selectedIndex;
      const prefix = selected ? this.settingsTheme.cursor : "  ";
      const label = this.settingsTheme.value(` ${option}`, selected);
      lines.push(`${prefix}${label}`);
    }

    lines.push("");

    const explanationBox = new Box(1, 0, (s: string) => s);
    explanationBox.addChild(
      new Markdown(
        explanations[this.selectedIndex] ?? "",
        0,
        0,
        getMarkdownTheme(),
        {
          color: (s: string) => this.theme.fg("text", s),
        },
      ),
    );

    lines.push(...explanationBox.render(Math.max(1, width)));

    return lines;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.up) || data === "k") {
      this.selectedIndex = this.selectedIndex === 0 ? 1 : 0;
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.selectedIndex = this.selectedIndex === 1 ? 0 : 1;
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.state.mode = this.selectedIndex === 0 ? "dedicated" : "proxy";
      this.wizCtx.markComplete();
      // Skip Providers tab in dedicated mode (advance twice)
      if (this.state.mode === "dedicated") {
        this.wizCtx.goNext();
        this.wizCtx.goNext();
      } else {
        this.wizCtx.goNext();
      }
    }
  }
}

class ProxyProvidersStep implements Component {
  private selectedIndex = 0;
  private readonly settingsTheme: SettingsTheme;
  private readonly providerIds: string[];
  private readonly checked: Set<string>;
  private readonly gatewayCheck: Set<string>;

  constructor(
    theme: Theme,
    private readonly state: OnboardingState,
    knownProviders: string[],
    private readonly onSelect: () => void,
  ) {
    this.settingsTheme = getSettingsTheme(theme);
    this.providerIds = knownProviders;

    // Pre-check providers that were previously configured
    this.checked = new Set(state.upstreamProviders.map((p) => p.id));
    this.gatewayCheck = new Set(
      state.upstreamProviders
        .filter((p) => p.shouldCheckGatewayModels)
        .map((p) => p.id),
    );
  }

  invalidate() {}

  render(_width: number): string[] {
    if (this.providerIds.length === 0) {
      return [
        "  No providers available in the model registry.",
        "",
        "  You can add proxy providers later in /aperture:settings.",
        "",
        this.settingsTheme.hint("  Enter: continue"),
      ];
    }

    const lines: string[] = [
      "  Select providers to route through Aperture:",
      "",
    ];

    for (let i = 0; i < this.providerIds.length; i++) {
      const id = this.providerIds[i];
      if (!id) continue;
      const selected = i === this.selectedIndex;
      const checked = this.checked.has(id);
      const prefix = selected ? this.settingsTheme.cursor : "  ";
      const check = checked ? "[x]" : "[ ]";
      const label = this.settingsTheme.value(` ${check} ${id}`, selected);
      lines.push(`${prefix}${label}`);

      // Show gateway check sub-option indented when provider is checked
      if (checked) {
        const gwChecked = this.gatewayCheck.has(id);
        const gwPrefix = selected ? "    " : "    ";
        const gwCheck = gwChecked ? "[x]" : "[ ]";
        const gwLabel = this.settingsTheme.hint(
          `  ${gwPrefix}${gwCheck} verify models on gateway`,
        );
        lines.push(gwLabel);
      }
    }

    lines.push("");
    lines.push(
      this.settingsTheme.hint(
        "  Enter: toggle provider · j/k: navigate · Tab: toggle gateway check · c: continue",
      ),
    );

    return lines;
  }

  handleInput(data: string): void {
    if (this.providerIds.length === 0) {
      if (matchesKey(data, Key.enter)) {
        this.saveState();
        this.onSelect();
      }
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") {
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.providerIds.length - 1
          : this.selectedIndex - 1;
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.selectedIndex =
        this.selectedIndex === this.providerIds.length - 1
          ? 0
          : this.selectedIndex + 1;
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const id = this.providerIds[this.selectedIndex];
      if (!id) return;
      if (this.checked.has(id)) {
        this.checked.delete(id);
        this.gatewayCheck.delete(id);
      } else {
        this.checked.add(id);
      }
      return;
    }

    if (matchesKey(data, Key.tab)) {
      const id = this.providerIds[this.selectedIndex];
      if (!id || !this.checked.has(id)) return;
      if (this.gatewayCheck.has(id)) {
        this.gatewayCheck.delete(id);
      } else {
        this.gatewayCheck.add(id);
      }
      return;
    }

    if (data === "c") {
      this.saveState();
      this.onSelect();
    }
  }

  private saveState(): void {
    this.state.upstreamProviders = this.providerIds
      .filter((id) => this.checked.has(id))
      .map((id) => ({
        id,
        shouldCheckGatewayModels: this.gatewayCheck.has(id),
      }));
  }
}

class FinishStep implements Component {
  private readonly recapMarkdown = new Markdown("", 2, 0, getMarkdownTheme());

  constructor(
    private readonly state: OnboardingState,
    private readonly onFinish: () => void,
  ) {}

  invalidate() {
    this.recapMarkdown.invalidate();
  }

  render(width: number): string[] {
    const modeLabel =
      this.state.mode === "dedicated"
        ? "Dedicated provider"
        : "Proxy existing providers";

    let content = `**URL**: \`${this.state.baseUrl || "(not set)"}\`\n\n**Mode**: ${modeLabel}`;

    if (this.state.mode === "proxy") {
      const count = this.state.upstreamProviders.length;
      if (count > 0) {
        const list = this.state.upstreamProviders
          .map(
            (p) =>
              `- \`${p.id}\`${
                p.shouldCheckGatewayModels ? " (gateway check on)" : ""
              }`,
          )
          .join("\n");
        content += `\n\n**Upstream providers** (${count}):\n${list}`;
      } else {
        content += "\n\n**Upstream providers**: none selected";
      }
    }

    this.recapMarkdown.setText(content);
    return [...this.recapMarkdown.render(Math.max(1, width)), ""];
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.enter)) {
      this.onFinish();
    }
  }
}

// --- Wizard factory ---

export function createOnboardingWizard(
  theme: Theme,
  tui: TUI,
  done: (result: OnboardingResult) => void,
  knownProviders: string[],
  currentConfig: ApertureConfig | null,
): Component {
  const state: OnboardingState = {
    baseUrl: currentConfig?.baseUrl ?? "",
    mode: null,
    upstreamProviders:
      currentConfig?.proxy?.upstreamProviders?.map((p) => ({
        id: p.id,
        shouldCheckGatewayModels: p.shouldCheckGatewayModels ?? false,
      })) ?? [],
  };

  let markWelcomeComplete: (() => void) | null = null;
  let settled = false;

  const finalize = (result: OnboardingResult) => {
    if (settled) return;
    settled = true;
    done(result);
  };

  const wizard = new Wizard({
    title: "Aperture Setup",
    theme,
    steps: [
      {
        label: "Welcome",
        build: (ctx) => {
          markWelcomeComplete = ctx.markComplete;
          return new IntroStep(() => {
            ctx.markComplete();
            ctx.goNext();
          });
        },
      },
      {
        label: "URL",
        build: (ctx: WizardStepContext) =>
          new UrlStep(
            getSettingsTheme(theme),
            tui,
            state.baseUrl,
            ctx,
            (url) => {
              state.baseUrl = url;
            },
          ),
      },
      {
        label: "Mode",
        build: (ctx: WizardStepContext) => new ModeStep(theme, state, ctx),
      },
      {
        label: "Providers",
        build: (ctx: WizardStepContext) =>
          new ProvidersStep(theme, state, knownProviders, ctx),
      },
      {
        label: "Recap",
        build: (ctx: WizardStepContext) =>
          new FinishStep(state, () => {
            if (state.mode === null) return;
            ctx.markComplete();
            finalize({
              completed: true,
              baseUrl: state.baseUrl,
              mode: state.mode,
              upstreamProviders: state.upstreamProviders,
            });
          }),
      },
    ],
    onComplete: () => {
      finalize({
        completed: state.mode !== null,
        baseUrl: state.baseUrl,
        mode: state.mode ?? "dedicated",
        upstreamProviders: state.upstreamProviders,
      });
    },
    onCancel: () =>
      finalize({
        completed: false,
        baseUrl: state.baseUrl,
        mode: state.mode ?? "dedicated",
        upstreamProviders: state.upstreamProviders,
      }),
    hintSuffix: "Enter select/continue",
    minContentHeight: 14,
  });

  return {
    render: (width: number) => wizard.render(width),
    invalidate: () => wizard.invalidate(),
    handleInput: (data: string) => {
      if (
        matchesKey(data, Key.tab) &&
        wizard.getActiveIndex() === 0 &&
        markWelcomeComplete
      ) {
        markWelcomeComplete();
      }
      wizard.handleInput(data);
    },
  };
}

/** Dynamic step: shows proxy providers in proxy mode, skip message in dedicated mode. */
class ProvidersStep implements Component {
  private proxyStep: ProxyProvidersStep | null = null;

  constructor(
    private readonly theme: Theme,
    private readonly state: OnboardingState,
    private readonly knownProviders: string[],
    private readonly wizCtx: WizardStepContext,
  ) {}

  invalidate() {
    this.proxyStep?.invalidate();
  }

  render(width: number): string[] {
    if (this.state.mode === "proxy") {
      if (!this.proxyStep) {
        this.proxyStep = new ProxyProvidersStep(
          this.theme,
          this.state,
          this.knownProviders,
          () => {
            this.wizCtx.markComplete();
            this.wizCtx.goNext();
          },
        );
      }
      return this.proxyStep.render(width);
    }

    // Dedicated mode: nothing to configure
    return [
      "  No proxy providers needed in dedicated mode.",
      "",
      this.settingsTheme.hint("  Press Enter to continue."),
    ];
  }

  private get settingsTheme(): SettingsTheme {
    return getSettingsTheme(this.theme);
  }

  handleInput(data: string): void {
    if (this.state.mode === "proxy" && this.proxyStep) {
      this.proxyStep.handleInput(data);
      return;
    }

    // Dedicated mode: Enter advances
    if (matchesKey(data, Key.enter)) {
      this.wizCtx.markComplete();
      this.wizCtx.goNext();
    }
  }
}

// --- Public helpers ---

export function isOnboardingPending(config: ApertureConfig | null): boolean {
  if (!config) return true;
  return config.onboardingDone !== true;
}

export function buildOnboardedConfig(
  baseUrl: string,
  mode: ApertureMode,
  upstreamProviders: { id: string; shouldCheckGatewayModels: boolean }[],
): ApertureConfig {
  return {
    baseUrl,
    mode,
    onboardingDone: true,
    proxy: {
      upstreamProviders: upstreamProviders.map((p) => ({
        id: p.id,
        shouldCheckGatewayModels: p.shouldCheckGatewayModels,
      })),
    },
    dedicated: {} as Record<string, never>,
  };
}
