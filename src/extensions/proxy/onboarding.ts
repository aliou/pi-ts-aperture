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
import type {
  ApertureConfig,
  ApertureMode,
  DedicatedProviderConfig,
} from "../../lib/config";
import { fetchGatewayProviders, type GatewayProvider } from "../../lib/gateway";
import { UrlStep } from "./setup-wizard";

// --- Onboarding state ---

export interface OnboardingResult {
  completed: boolean;
  baseUrl: string;
  mode: ApertureMode;
  upstreamProviders: { id: string; shouldCheckGatewayModels: boolean }[];
  dedicatedProviders: DedicatedProviderConfig[];
}

interface OnboardingState {
  baseUrl: string;
  mode: ApertureMode | null;
  upstreamProviders: { id: string; shouldCheckGatewayModels: boolean }[];
  dedicatedProviders: DedicatedProviderConfig[];
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
      this.wizCtx.goNext();
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
        "  Space: toggle · j/k: navigate · g: toggle gateway check · Enter/Tab: continue",
      ),
    );

    return lines;
  }

  handleInput(data: string): void {
    if (this.providerIds.length === 0) {
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.tab)) {
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

    if (matchesKey(data, Key.space)) {
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

    if (data === "g") {
      const id = this.providerIds[this.selectedIndex];
      if (!id || !this.checked.has(id)) return;
      if (this.gatewayCheck.has(id)) {
        this.gatewayCheck.delete(id);
      } else {
        this.gatewayCheck.add(id);
      }
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.tab)) {
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

    if (this.state.mode === "dedicated") {
      const enabled = this.state.dedicatedProviders.filter((p) => p.enabled);
      const disabled = this.state.dedicatedProviders.filter((p) => !p.enabled);
      if (enabled.length > 0) {
        const list = enabled.map((p) => `- \`${p.name ?? p.id}\``).join("\n");
        content += `\n\n**Aperture providers** (${enabled.length}):\n${list}`;
      }
      if (disabled.length > 0) {
        const list = disabled
          .map((p) => `- ~~\`${p.name ?? p.id}\`~~`)
          .join("\n");
        content += `\n\n**Excluded** (${disabled.length}):\n${list}`;
      }
      if (this.state.dedicatedProviders.length === 0) {
        content += "\n\n**Aperture providers**: all (no filter)";
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
    dedicatedProviders:
      currentConfig?.dedicated?.providers?.map((p) => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled,
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
          new ProvidersStep(theme, tui, state, knownProviders, ctx),
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
              dedicatedProviders: state.dedicatedProviders,
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
        dedicatedProviders: state.dedicatedProviders,
      });
    },
    onCancel: () =>
      finalize({
        completed: false,
        baseUrl: state.baseUrl,
        mode: state.mode ?? "dedicated",
        upstreamProviders: state.upstreamProviders,
        dedicatedProviders: state.dedicatedProviders,
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

/** Dynamic step: shows Aperture provider selection in dedicated mode, proxy providers in proxy mode. */
class ProvidersStep implements Component {
  private proxyStep: ProxyProvidersStep | null = null;
  private dedicatedStep: DedicatedProvidersStep | null = null;

  constructor(
    private readonly theme: Theme,
    private readonly tui: TUI,
    private readonly state: OnboardingState,
    private readonly knownProviders: string[],
    private readonly wizCtx: WizardStepContext,
  ) {}

  invalidate() {
    this.proxyStep?.invalidate();
    this.dedicatedStep?.invalidate();
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

    if (this.state.mode === "dedicated") {
      if (!this.dedicatedStep) {
        this.dedicatedStep = new DedicatedProvidersStep(
          this.theme,
          this.tui,
          this.state,
          () => {
            this.wizCtx.markComplete();
            this.wizCtx.goNext();
          },
        );
      }
      return this.dedicatedStep.render(width);
    }

    return [
      "  Select a mode first.",
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
    if (this.state.mode === "dedicated" && this.dedicatedStep) {
      this.dedicatedStep.handleInput(data);
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.wizCtx.markComplete();
      this.wizCtx.goNext();
    }
  }
}

/** Dedicated mode: select which Aperture gateway providers to include. */
class DedicatedProvidersStep implements Component {
  private selectedIndex = 0;
  private readonly settingsTheme: SettingsTheme;
  private providers: GatewayProvider[] = [];
  private readonly enabled: Set<string>;
  private loading = true;
  private error = "";

  constructor(
    theme: Theme,
    private readonly tui: TUI,
    private readonly state: OnboardingState,
    private readonly onSelect: () => void,
  ) {
    this.settingsTheme = getSettingsTheme(theme);
    // Pre-enable providers that were previously selected
    this.enabled = new Set(
      state.dedicatedProviders.filter((p) => p.enabled).map((p) => p.id),
    );
    // Fetch providers from gateway
    this.fetchProviders();
  }

  private async fetchProviders(): Promise<void> {
    try {
      const providers = await fetchGatewayProviders(this.state.baseUrl);
      this.providers = providers;
      // Auto-select all if no prior selection exists
      if (this.state.dedicatedProviders.length === 0) {
        for (const p of providers) {
          this.enabled.add(p.id);
        }
      } else {
        // Auto-enable any new providers not in prior config
        for (const p of providers) {
          if (!this.state.dedicatedProviders.some((c) => c.id === p.id)) {
            this.enabled.add(p.id);
          }
        }
      }
      this.loading = false;
      this.tui.requestRender();
    } catch {
      this.error = "Failed to fetch providers from gateway";
      this.loading = false;
      this.tui.requestRender();
    }
  }

  invalidate() {}

  render(_width: number): string[] {
    if (this.loading) {
      return [
        "  Fetching providers from Aperture gateway...",
        "",
        this.settingsTheme.hint("  Please wait."),
      ];
    }

    if (this.error) {
      return [
        `  ${this.error}`,
        "",
        this.settingsTheme.hint("  Enter: continue without provider filter"),
      ];
    }

    if (this.providers.length === 0) {
      return [
        "  No providers found on the Aperture gateway.",
        "",
        this.settingsTheme.hint("  Enter: continue"),
      ];
    }

    const lines: string[] = ["  Select Aperture providers to include:", ""];

    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      if (!provider) continue;
      const selected = i === this.selectedIndex;
      const checked = this.enabled.has(provider.id);
      const prefix = selected ? this.settingsTheme.cursor : "  ";
      const check = checked ? "[x]" : "[ ]";
      const label = this.settingsTheme.value(
        ` ${check} ${provider.name ?? provider.id}`,
        selected,
      );
      lines.push(`${prefix}${label}`);
    }

    lines.push("");
    lines.push(
      this.settingsTheme.hint(
        "  Space: toggle · j/k: navigate · Enter/Tab: continue",
      ),
    );

    return lines;
  }

  handleInput(data: string): void {
    if (this.loading) return;

    if (this.providers.length === 0 || this.error) {
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.tab)) {
        this.saveState();
        this.onSelect();
      }
      return;
    }

    if (matchesKey(data, Key.up) || data === "k") {
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.providers.length - 1
          : this.selectedIndex - 1;
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.selectedIndex =
        this.selectedIndex === this.providers.length - 1
          ? 0
          : this.selectedIndex + 1;
      return;
    }

    if (matchesKey(data, Key.space)) {
      const provider = this.providers[this.selectedIndex];
      if (!provider) return;
      if (this.enabled.has(provider.id)) {
        this.enabled.delete(provider.id);
      } else {
        this.enabled.add(provider.id);
      }
      return;
    }

    if (matchesKey(data, Key.enter) || matchesKey(data, Key.tab)) {
      this.saveState();
      this.onSelect();
    }
  }

  private saveState(): void {
    this.state.dedicatedProviders = this.providers.map((p) => ({
      id: p.id,
      name: p.name,
      enabled: this.enabled.has(p.id),
    }));
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
  dedicatedProviders: DedicatedProviderConfig[],
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
    dedicated: {
      providers: dedicatedProviders,
    },
  };
}
