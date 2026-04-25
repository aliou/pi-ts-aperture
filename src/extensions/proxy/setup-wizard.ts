/**
 * UrlStep -- TUI component for the Aperture URL input with inline health check.
 */

import type {
  SettingsTheme,
  WizardStepContext,
} from "@aliou/pi-utils-settings";
import type { Component, TUI } from "@mariozechner/pi-tui";
import { Input } from "@mariozechner/pi-tui";
import { checkApertureHealth } from "../../lib/gateway";
import { normalizeInputUrl } from "../../lib/url";

export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
];

export class UrlStep implements Component {
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
