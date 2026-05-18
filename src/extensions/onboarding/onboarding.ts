/**
 * Onboarding wizard for Aperture extension.
 *
 * Steps:
 * 1. Welcome -- explain Aperture and the two modes
 * 2. URL -- input with inline health check
 * 3. Mode -- choose dedicated or proxy
 * 4. Providers -- context-dependent: proxy providers or dedicated gateway providers
 * 5. Recap -- summary before saving
 */

import {
  getSettingsTheme,
  type SettingsTheme,
  Wizard,
  type WizardStepContext,
} from "@aliou/pi-utils-settings";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Box, Key, Markdown, matchesKey, Text } from "@earendil-works/pi-tui";
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

// --- Shared filterable checklist ---

const LIST_HEIGHT = 6;

interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

class FilterableChecklist implements Component {
  private searchTextValue = "";
  private selectedIndex = 0;
  private scrollOffset = 0;

  /** Extra hint line shown below the standard hints. */
  private extraHint = "";

  private items: ChecklistItem[];

  constructor(
    private readonly settingsTheme: SettingsTheme,
    items: ChecklistItem[],
    private readonly onToggle: (id: string) => void,
    /** Optional handler for Ctrl+G (e.g. gateway check toggle). */
    private readonly onCtrlG?: () => void,
  ) {
    this.items = items;
  }

  /** Update items in place (preserves search state). */
  updateItems(items: ChecklistItem[]): void {
    this.items = items;
  }

  /** Set extra hint text shown below the standard key hints. */
  setExtraHint(hint: string): void {
    this.extraHint = hint;
  }

  invalidate() {}

  /** Filtered items based on current search query. */
  private get filtered(): ChecklistItem[] {
    const query = this.searchTextValue.toLowerCase().trim();
    if (!query) return this.items;
    return this.items.filter(
      (item) =>
        item.id.toLowerCase().includes(query) ||
        item.label.toLowerCase().includes(query),
    );
  }

  private clampScroll(): void {
    const count = this.filtered.length;
    const maxOffset = Math.max(0, count - LIST_HEIGHT);
    this.scrollOffset = Math.min(this.scrollOffset, maxOffset);

    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + LIST_HEIGHT) {
      this.scrollOffset = this.selectedIndex - LIST_HEIGHT + 1;
    }
  }

  render(_width: number): string[] {
    const lines: string[] = [];

    // Search bar (always active)
    const displayText = this.searchTextValue || "type to filter...";
    const styledText = this.searchTextValue
      ? displayText
      : this.settingsTheme.hint(displayText);
    lines.push(`  > ${styledText}`);
    lines.push("");

    const filtered = this.filtered;
    if (filtered.length === 0) {
      lines.push(this.settingsTheme.hint("  No matching providers."));
      for (let i = 1; i < LIST_HEIGHT; i++) lines.push("");
    } else {
      this.clampScroll();
      const above = this.scrollOffset;
      const below = Math.max(
        0,
        filtered.length - this.scrollOffset - LIST_HEIGHT,
      );

      if (above > 0) {
        lines.push(this.settingsTheme.hint(`  \u2191 ${above} more above`));
      } else {
        lines.push("");
      }

      for (
        let i = this.scrollOffset;
        i < this.scrollOffset + LIST_HEIGHT;
        i++
      ) {
        const item = filtered[i];
        if (!item) {
          lines.push("");
          continue;
        }
        const selected = i === this.selectedIndex;
        const prefix = selected ? this.settingsTheme.cursor : "  ";
        const check = item.checked ? "[x]" : "[ ]";
        const label = this.settingsTheme.value(
          ` ${check} ${item.label}`,
          selected,
        );
        lines.push(`${prefix}${label}`);
      }

      if (below > 0) {
        lines.push(this.settingsTheme.hint(`  \u2193 ${below} more below`));
      } else {
        lines.push("");
      }
    }

    lines.push("");
    const hints = ["\u2191\u2193: navigate", "Enter: toggle"];
    if (this.onCtrlG) hints.push("Ctrl+G: gateway check");
    lines.push(this.settingsTheme.hint(`  ${hints.join(" \u00b7 ")}`));
    if (this.extraHint) {
      lines.push(this.settingsTheme.hint(`  ${this.extraHint}`));
    }

    return lines;
  }

  handleInput(data: string): void {
    // Ctrl+G: optional action (e.g. toggle gateway check)
    if (this.onCtrlG && matchesKey(data, Key.ctrl("g"))) {
      this.onCtrlG();
      return;
    }

    // Up/down: navigate filtered list
    if (matchesKey(data, Key.up)) {
      if (this.filtered.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filtered.length - 1
          : this.selectedIndex - 1;
      this.clampScroll();
      return;
    }
    if (matchesKey(data, Key.down)) {
      if (this.filtered.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filtered.length - 1
          ? 0
          : this.selectedIndex + 1;
      this.clampScroll();
      return;
    }

    // Enter: toggle selected item
    if (matchesKey(data, Key.enter)) {
      const item = this.filtered[this.selectedIndex];
      if (!item) return;
      this.onToggle(item.id);
      return;
    }

    // Backspace: delete last search char
    if (matchesKey(data, Key.backspace)) {
      this.searchTextValue = this.searchTextValue.slice(0, -1);
      this.selectedIndex = 0;
      this.scrollOffset = 0;
      return;
    }

    // Printable character: append to search
    if (data.length === 1 && data >= " " && data <= "~") {
      this.searchTextValue += data;
      this.selectedIndex = 0;
      this.scrollOffset = 0;
    }
  }
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
        "- Models use default config (shared context window, no reasoning) since Aperture does not expose full model details yet",
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
  private readonly settingsTheme: SettingsTheme;
  private readonly providerIds: string[];
  private readonly checked: Set<string>;
  private checkAllGateway = true;
  private checklist: FilterableChecklist | null = null;

  constructor(
    theme: Theme,
    private readonly state: OnboardingState,
    knownProviders: string[],
  ) {
    this.settingsTheme = getSettingsTheme(theme);
    this.providerIds = knownProviders;
    this.checked = new Set(state.upstreamProviders.map((p) => p.id));
    const allCheckedGateway =
      state.upstreamProviders.length > 0 &&
      state.upstreamProviders.every((p) => p.shouldCheckGatewayModels);
    this.checkAllGateway = allCheckedGateway;
  }

  private buildItems(): ChecklistItem[] {
    return this.providerIds.map((id) => ({
      id,
      label: id,
      checked: this.checked.has(id),
    }));
  }

  invalidate() {}

  render(width: number): string[] {
    if (this.providerIds.length === 0) {
      return [
        "  No providers available in the model registry.",
        "",
        "  You can add proxy providers later in /aperture:settings.",
      ];
    }

    if (!this.checklist) {
      this.checklist = new FilterableChecklist(
        this.settingsTheme,
        this.buildItems(),
        (id) => this.toggleProvider(id),
        () => this.toggleGatewayCheck(),
      );
    } else {
      this.checklist.updateItems(this.buildItems());
    }

    const gwLabel = this.checkAllGateway ? "on" : "off";
    this.checklist.setExtraHint(`gateway model check: ${gwLabel}`);

    return [
      "  Select providers to route through Aperture:",
      "",
      ...this.checklist.render(width),
    ];
  }

  private toggleProvider(id: string): void {
    if (this.checked.has(id)) {
      this.checked.delete(id);
    } else {
      this.checked.add(id);
    }
    this.saveState();
  }

  private toggleGatewayCheck(): void {
    this.checkAllGateway = !this.checkAllGateway;
    this.saveState();
  }

  handleInput(data: string): void {
    this.checklist?.handleInput(data);
  }

  private saveState(): void {
    this.state.upstreamProviders = this.providerIds
      .filter((id) => this.checked.has(id))
      .map((id) => ({
        id,
        shouldCheckGatewayModels: this.checkAllGateway,
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
        );
        this.wizCtx.markComplete();
      }
      return this.proxyStep.render(width);
    }

    if (this.state.mode === "dedicated") {
      if (!this.dedicatedStep) {
        this.dedicatedStep = new DedicatedProvidersStep(
          this.theme,
          this.tui,
          this.state,
        );
        this.wizCtx.markComplete();
      }
      return this.dedicatedStep.render(width);
    }

    return ["  Select a mode first."];
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
  }
}

/** Dedicated mode: select which Aperture gateway providers to include. */
class DedicatedProvidersStep implements Component {
  private readonly settingsTheme: SettingsTheme;
  private providers: GatewayProvider[] = [];
  private readonly enabled: Set<string>;
  private loading = true;
  private error = "";
  private checklist: FilterableChecklist | null = null;

  constructor(
    theme: Theme,
    private readonly tui: TUI,
    private readonly state: OnboardingState,
  ) {
    this.settingsTheme = getSettingsTheme(theme);
    this.enabled = new Set(
      state.dedicatedProviders.filter((p) => p.enabled).map((p) => p.id),
    );
    this.fetchProviders();
  }

  private async fetchProviders(): Promise<void> {
    try {
      const providers = await fetchGatewayProviders(this.state.baseUrl);
      this.providers = providers;
      if (this.state.dedicatedProviders.length === 0) {
        for (const p of providers) {
          this.enabled.add(p.id);
        }
      } else {
        for (const p of providers) {
          if (!this.state.dedicatedProviders.some((c) => c.id === p.id)) {
            this.enabled.add(p.id);
          }
        }
      }
      this.loading = false;
      this.saveState();
      this.tui.requestRender();
    } catch {
      this.error = "Failed to fetch providers from gateway";
      this.loading = false;
      this.tui.requestRender();
    }
  }

  private buildItems(): ChecklistItem[] {
    return this.providers.map((p) => ({
      id: p.id,
      label: p.name ?? p.id,
      checked: this.enabled.has(p.id),
    }));
  }

  invalidate() {}

  render(width: number): string[] {
    if (this.loading) {
      return [
        "  Fetching providers from Aperture gateway...",
        "",
        this.settingsTheme.hint("  Please wait."),
      ];
    }

    if (this.error) {
      return [`  ${this.error}`, ""];
    }

    if (this.providers.length === 0) {
      return ["  No providers found on the Aperture gateway.", ""];
    }

    if (!this.checklist) {
      this.checklist = new FilterableChecklist(
        this.settingsTheme,
        this.buildItems(),
        (id) => this.toggleProvider(id),
      );
    } else {
      this.checklist.updateItems(this.buildItems());
    }

    return [
      "  Select Aperture providers to include:",
      "",
      ...this.checklist.render(width),
    ];
  }

  private toggleProvider(id: string): void {
    if (this.enabled.has(id)) {
      this.enabled.delete(id);
    } else {
      this.enabled.add(id);
    }
    this.saveState();
  }

  handleInput(data: string): void {
    if (this.loading) return;
    this.checklist?.handleInput(data);
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

export function isOnboardingExtensionEnabled(
  config: ApertureConfig | null,
): boolean {
  if (!config) return true;
  return config.onboarding?.enabled ?? config.onboardingDone !== true;
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
    onboarding: {
      enabled: false,
    },
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
