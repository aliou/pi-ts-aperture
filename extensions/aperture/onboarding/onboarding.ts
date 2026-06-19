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
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import {
  Box,
  getKeybindings,
  Input,
  Key,
  Markdown,
  matchesKey,
  Text,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { ApertureClient } from "../../../src/api/client";
import {
  mapDedicatedProviders,
  mapProxyProviders,
} from "../../../src/provider-mapping";
import type {
  ApertureConfig,
  DedicatedProviderConfig,
} from "../../../src/shared/config/loader";
import { UrlStep } from "./setup-wizard";

// --- Onboarding state ---

export interface OnboardingResult {
  completed: boolean;
  baseUrl: string;
  proxyEnabled: boolean;
  dedicatedEnabled: boolean;
  upstreamProviders: { id: string; shouldCheckGatewayModels: boolean }[];
  dedicatedProviders: DedicatedProviderConfig[];
}

interface OnboardingState {
  baseUrl: string;
  proxyEnabled: boolean;
  dedicatedEnabled: boolean;
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
  private readonly searchInput = new Input();
  private selectedIndex = 0;
  private extraHint = "";
  private items: ChecklistItem[];
  private filteredItems: ChecklistItem[];

  constructor(
    private readonly settingsTheme: SettingsTheme,
    items: ChecklistItem[],
    private readonly onToggle: (id: string) => void,
    /** Optional handler for Ctrl+G (e.g. gateway check toggle). */
    private readonly onCtrlG?: () => void,
  ) {
    this.items = items;
    this.filteredItems = items;
  }

  updateItems(items: ChecklistItem[]): void {
    this.items = items;
    this.applyFilter(this.searchInput.getValue());
  }

  setExtraHint(hint: string): void {
    this.extraHint = hint;
  }

  invalidate() {}

  private applyFilter(query: string): void {
    const normalized = query.toLowerCase().trim();
    this.filteredItems = normalized
      ? this.items.filter(
          (item) =>
            item.id.toLowerCase().includes(normalized) ||
            item.label.toLowerCase().includes(normalized),
        )
      : this.items;
    this.selectedIndex = Math.max(
      0,
      Math.min(this.selectedIndex, this.filteredItems.length - 1),
    );
  }

  render(width: number): string[] {
    const lines: string[] = [];

    lines.push(
      ...this.searchInput.render(Math.max(1, width - 4)).map((l) => `  ${l}`),
    );
    lines.push("");

    if (this.filteredItems.length === 0) {
      lines.push(this.settingsTheme.hint("  No matching providers."));
      return lines;
    }

    const startIndex = Math.max(
      0,
      Math.min(
        this.selectedIndex - Math.floor(LIST_HEIGHT / 2),
        this.filteredItems.length - LIST_HEIGHT,
      ),
    );
    const endIndex = Math.min(
      startIndex + LIST_HEIGHT,
      this.filteredItems.length,
    );

    for (let i = startIndex; i < endIndex; i++) {
      const item = this.filteredItems[i];
      if (!item) continue;
      const selected = i === this.selectedIndex;
      const prefix = selected ? this.settingsTheme.cursor : "  ";
      const check = item.checked ? "[x]" : "[ ]";
      const label = truncateToWidth(
        `${check} ${item.label}`,
        Math.max(1, width - 6),
        "…",
      );
      lines.push(`${prefix}${this.settingsTheme.value(` ${label}`, selected)}`);
    }

    if (startIndex > 0 || endIndex < this.filteredItems.length) {
      lines.push(
        this.settingsTheme.hint(
          `  (${this.selectedIndex + 1}/${this.filteredItems.length})`,
        ),
      );
    }

    lines.push("");
    const hints = ["↑↓: navigate", "Space: toggle"];
    if (this.onCtrlG) hints.push("Ctrl+G: gateway check");
    lines.push(this.settingsTheme.hint(`  ${hints.join(" · ")}`));
    if (this.extraHint) {
      lines.push(
        ...wrapTextWithAnsi(this.extraHint, Math.max(1, width - 4)).map(
          (line) => this.settingsTheme.hint(`  ${line}`),
        ),
      );
    }

    return lines;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (this.onCtrlG && matchesKey(data, Key.ctrl("g"))) {
      this.onCtrlG();
      return;
    }

    if (kb.matches(data, "tui.select.up")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === 0
          ? this.filteredItems.length - 1
          : this.selectedIndex - 1;
      return;
    }

    if (kb.matches(data, "tui.select.down")) {
      if (this.filteredItems.length === 0) return;
      this.selectedIndex =
        this.selectedIndex === this.filteredItems.length - 1
          ? 0
          : this.selectedIndex + 1;
      return;
    }

    if (kb.matches(data, "tui.select.pageUp")) {
      this.selectedIndex = Math.max(0, this.selectedIndex - LIST_HEIGHT);
      return;
    }

    if (kb.matches(data, "tui.select.pageDown")) {
      this.selectedIndex = Math.min(
        Math.max(0, this.filteredItems.length - 1),
        this.selectedIndex + LIST_HEIGHT,
      );
      return;
    }

    if (data === " ") {
      const item = this.filteredItems[this.selectedIndex];
      if (item) this.onToggle(item.id);
      return;
    }

    this.searchInput.handleInput(data);
    this.applyFilter(this.searchInput.getValue());
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

class CapabilitiesStep implements Component {
  private selectedIndex = 0;
  private readonly settingsTheme: SettingsTheme;

  constructor(
    private readonly theme: Theme,
    private readonly state: OnboardingState,
    private readonly wizCtx: WizardStepContext,
    private readonly onSelected: () => void,
  ) {
    this.settingsTheme = getSettingsTheme(theme);
  }

  invalidate() {}

  render(width: number): string[] {
    const options = ["Dedicated only", "Proxy only", "Both"];
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
      [
        "Enable both capabilities at the same time.",
        "",
        "- `aperture` exposes gateway models directly",
        "- Selected existing Pi providers are also proxied",
        "- The same gateway provider can be used in both capabilities",
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
      this.selectedIndex =
        this.selectedIndex === 0 ? 2 : this.selectedIndex - 1;
      return;
    }
    if (matchesKey(data, Key.down) || data === "j") {
      this.selectedIndex =
        this.selectedIndex === 2 ? 0 : this.selectedIndex + 1;
      return;
    }

    if (matchesKey(data, Key.enter)) {
      this.state.dedicatedEnabled =
        this.selectedIndex === 0 || this.selectedIndex === 2;
      this.state.proxyEnabled =
        this.selectedIndex === 1 || this.selectedIndex === 2;
      this.wizCtx.markComplete();
      this.onSelected();
    }
  }
}

class ProxyProvidersStep implements Component {
  private readonly settingsTheme: SettingsTheme;
  private providers: ReturnType<typeof mapProxyProviders> = [];
  private readonly checked: Set<string>;
  private checkAllGateway = true;
  private loading = true;
  private error = "";
  private checklist: FilterableChecklist | null = null;

  constructor(
    theme: Theme,
    private readonly tui: TUI,
    private readonly state: OnboardingState,
    private readonly knownModels: Model<Api>[],
    private readonly wizCtx: WizardStepContext,
  ) {
    this.settingsTheme = getSettingsTheme(theme);
    this.checked = new Set(state.upstreamProviders.map((p) => p.id));
    const allCheckedGateway =
      state.upstreamProviders.length > 0 &&
      state.upstreamProviders.every((p) => p.shouldCheckGatewayModels);
    this.checkAllGateway = allCheckedGateway;
    this.fetchProviders();
  }

  private async fetchProviders(): Promise<void> {
    try {
      const client = new ApertureClient(this.state.baseUrl);
      const [providerInfos, gatewayProviders] = await Promise.all([
        client.providerConfigInfos(),
        client.providers(),
      ]);
      this.providers = mapProxyProviders(
        this.knownModels,
        providerInfos,
        gatewayProviders,
        this.state.upstreamProviders,
      );
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
    return this.providers.map((provider) => ({
      id: provider.id,
      label: provider.name ?? provider.id,
      checked: this.checked.has(provider.id),
    }));
  }

  invalidate() {}

  render(width: number): string[] {
    if (this.loading) {
      return [
        "  Fetching proxy providers from Aperture gateway...",
        "",
        this.settingsTheme.hint("  Please wait."),
      ];
    }

    if (this.error) {
      return [`  ${this.error}`, ""];
    }

    if (this.providers.length === 0) {
      return [
        "  No local providers match the Aperture gateway provider base URLs.",
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
    this.checklist.setExtraHint(
      `gateway model check: ${gwLabel} — warns if local provider models are missing from Aperture`,
    );

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
    if (this.loading) return;
    if (matchesKey(data, Key.enter)) {
      this.wizCtx.markComplete();
      this.wizCtx.goNext();
      return;
    }
    if (this.checklist) {
      this.checklist.handleInput(data);
      if (data === " ") this.wizCtx.markComplete();
    }
  }

  private saveState(): void {
    this.state.upstreamProviders = this.providers
      .map((provider) => provider.id)
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
    const capabilityLabel = this.state.dedicatedEnabled
      ? this.state.proxyEnabled
        ? "Dedicated provider and proxy"
        : "Dedicated provider"
      : "Proxy existing providers";

    let content = `**URL**: \`${this.state.baseUrl || "(not set)"}\`\n\n**Capabilities**: ${capabilityLabel}`;

    if (this.state.proxyEnabled) {
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

    if (this.state.dedicatedEnabled) {
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
  knownModels: Model<Api>[],
  currentConfig: ApertureConfig | null,
): Component {
  const state: OnboardingState = {
    baseUrl: currentConfig?.baseUrl ?? "",
    proxyEnabled: currentConfig?.proxy?.enabled ?? false,
    dedicatedEnabled: currentConfig?.dedicated?.enabled ?? true,
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
  let wizard: Wizard;
  let settled = false;

  const finalize = (result: OnboardingResult) => {
    if (settled) return;
    settled = true;
    done(result);
  };

  const finish = (markComplete: () => void) => {
    if (!state.proxyEnabled && !state.dedicatedEnabled) return;
    markComplete();
    finalize({
      completed: true,
      baseUrl: state.baseUrl,
      proxyEnabled: state.proxyEnabled,
      dedicatedEnabled: state.dedicatedEnabled,
      upstreamProviders: state.upstreamProviders,
      dedicatedProviders: state.dedicatedProviders,
    });
  };

  const buildWizard = (activeLabel?: string): Wizard => {
    const steps = [
      {
        label: "Welcome",
        build: (ctx: WizardStepContext) => {
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
        label: "Capabilities",
        build: (ctx: WizardStepContext) =>
          new CapabilitiesStep(theme, state, ctx, () => {
            const nextLabel = state.dedicatedEnabled
              ? "Dedicated"
              : state.proxyEnabled
                ? "Proxy"
                : "Recap";
            wizard = buildWizard(nextLabel);
            tui.requestRender();
          }),
      },
      ...(state.dedicatedEnabled
        ? [
            {
              label: "Dedicated",
              build: (ctx: WizardStepContext) =>
                new DedicatedProvidersStep(theme, tui, state, ctx),
            },
          ]
        : []),
      ...(state.proxyEnabled
        ? [
            {
              label: "Proxy",
              build: (ctx: WizardStepContext) =>
                new ProxyProvidersStep(theme, tui, state, knownModels, ctx),
            },
          ]
        : []),
      {
        label: "Recap",
        build: (ctx: WizardStepContext) =>
          new FinishStep(state, () => finish(ctx.markComplete)),
      },
    ];

    const nextWizard = new Wizard({
      title: "Aperture Setup",
      theme,
      steps,
      onComplete: () => {
        finalize({
          completed: state.proxyEnabled || state.dedicatedEnabled,
          baseUrl: state.baseUrl,
          proxyEnabled: state.proxyEnabled,
          dedicatedEnabled: state.dedicatedEnabled,
          upstreamProviders: state.upstreamProviders,
          dedicatedProviders: state.dedicatedProviders,
        });
      },
      onCancel: () =>
        finalize({
          completed: false,
          baseUrl: state.baseUrl,
          proxyEnabled: state.proxyEnabled,
          dedicatedEnabled: state.dedicatedEnabled,
          upstreamProviders: state.upstreamProviders,
          dedicatedProviders: state.dedicatedProviders,
        }),
      hintSuffix: "Enter select/continue",
      minContentHeight: 14,
    });

    const activeIndex = activeLabel
      ? steps.findIndex((step) => step.label === activeLabel)
      : 0;
    if (activeIndex > 0) {
      const wizardState = nextWizard as unknown as {
        activeIndex: number;
        completed: boolean[];
      };
      wizardState.activeIndex = activeIndex;
      for (let i = 0; i < activeIndex; i++) {
        wizardState.completed[i] = true;
      }
    }
    return nextWizard;
  };

  wizard = buildWizard();

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

/** Dedicated mode: select which Aperture gateway providers to include. */
class DedicatedProvidersStep implements Component {
  private readonly settingsTheme: SettingsTheme;
  private providers: DedicatedProviderConfig[] = [];
  private readonly enabled: Set<string>;
  private loading = true;
  private error = "";
  private checklist: FilterableChecklist | null = null;

  constructor(
    theme: Theme,
    private readonly tui: TUI,
    private readonly state: OnboardingState,
    private readonly wizCtx: WizardStepContext,
  ) {
    this.settingsTheme = getSettingsTheme(theme);
    this.enabled = new Set(
      state.dedicatedProviders.filter((p) => p.enabled).map((p) => p.id),
    );
    this.fetchProviders();
  }

  private async fetchProviders(): Promise<void> {
    try {
      const gatewayProviders = await new ApertureClient(
        this.state.baseUrl,
      ).providers();
      this.providers = mapDedicatedProviders(
        gatewayProviders,
        this.state.dedicatedProviders,
      );
      this.enabled.clear();
      for (const provider of this.providers) {
        if (provider.enabled) this.enabled.add(provider.id);
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
    if (matchesKey(data, Key.enter)) {
      this.wizCtx.markComplete();
      this.wizCtx.goNext();
      return;
    }
    if (this.checklist) {
      this.checklist.handleInput(data);
      if (data === " ") this.wizCtx.markComplete();
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

export function isOnboardingExtensionEnabled(
  config: ApertureConfig | null,
): boolean {
  if (!config) return true;
  return config.onboarding?.enabled ?? config.onboardingDone !== true;
}

export function buildOnboardedConfig(
  baseUrl: string,
  proxyEnabled: boolean,
  dedicatedEnabled: boolean,
  upstreamProviders: { id: string; shouldCheckGatewayModels: boolean }[],
  dedicatedProviders: DedicatedProviderConfig[],
): ApertureConfig {
  return {
    baseUrl,
    onboardingDone: true,
    onboarding: {
      enabled: false,
    },
    proxy: {
      enabled: proxyEnabled,
      upstreamProviders: upstreamProviders.map((p) => ({
        id: p.id,
        shouldCheckGatewayModels: p.shouldCheckGatewayModels,
      })),
    },
    dedicated: {
      enabled: dedicatedEnabled,
      providers: dedicatedProviders,
    },
  };
}
