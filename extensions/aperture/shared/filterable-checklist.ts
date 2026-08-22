/**
 * Filterable checklist component shared by onboarding and settings.
 *
 * Renders a search input + scrollable list of checkbox items. Items are
 * filtered by case-insensitive substring match on id or label. Toggling is
 * done with Space. Optional Esc handling lets the host close the checklist
 * (used by the pinned-tools settings submenu; onboarding binds its own
 * Enter/Esc at the step level).
 */

import type { SettingsTheme } from "@aliou/pi-utils-settings";
import type { Component } from "@earendil-works/pi-tui";
import {
  getKeybindings,
  Input,
  Key,
  matchesKey,
  truncateToWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

const LIST_HEIGHT = 6;

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export class FilterableChecklist implements Component {
  private readonly searchInput = new Input();
  private selectedIndex = 0;
  private extraHint = "";
  private items: ChecklistItem[];
  private filteredItems: ChecklistItem[];

  constructor(
    private readonly settingsTheme: SettingsTheme,
    items: ChecklistItem[],
    private readonly onToggle: (id: string) => void,
    /** Optional Ctrl+G handler (e.g. proxy gateway check toggle). */
    private readonly onCtrlG?: () => void,
    /**
     * Optional close handler invoked on Esc. When omitted, Esc falls through
     * to the search input (see Input.handleInput), which matches the original
     * onboarding behavior.
     */
    private readonly onClose?: () => void,
    /**
     * Hide the built-in footer hint line (when the host panel renders its
     * own controls line). Hosts read the shortcuts to display via
     * {@link getShortcuts}; registerSettingsCommand wires this through the
     * submenu factory context (`ctx.hideHint`). Default false.
     */
    private readonly hideHint = false,
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

  /**
   * Shortcuts the checklist currently responds to, matching the footer hint
   * line. Host panels (SectionedSettings via registerSettingsCommand) use
   * this to render a single unified controls line while the checklist is
   * open as a submenu.
   */
  getShortcuts(): string {
    const hints = ["↑↓: navigate", "Space: toggle"];
    if (this.onCtrlG) hints.push("Ctrl+G: gateway check");
    if (this.onClose) hints.push("Esc: back");
    return hints.join(" · ");
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
      lines.push(this.settingsTheme.hint("  No matching items."));
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

    const footer: string[] = [];
    if (!this.hideHint) {
      footer.push(this.settingsTheme.hint(`  ${this.getShortcuts()}`));
    }
    if (this.extraHint) {
      footer.push(
        ...wrapTextWithAnsi(this.extraHint, Math.max(1, width - 4)).map(
          (line) => this.settingsTheme.hint(`  ${line}`),
        ),
      );
    }
    if (footer.length > 0) {
      lines.push("", ...footer);
    }

    return lines;
  }

  handleInput(data: string): void {
    const kb = getKeybindings();

    if (this.onClose && matchesKey(data, Key.escape)) {
      this.onClose();
      return;
    }

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
