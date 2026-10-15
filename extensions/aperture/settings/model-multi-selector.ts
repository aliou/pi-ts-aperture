import {
  FuzzyMultiSelector,
  type SettingsTheme,
} from "@aliou/pi-utils-settings";
import type { Component } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";

export interface ModelMultiSelectorOptions {
  /** Heading shown above the list. */
  title: string;
  /** Selectable model/provider ids. */
  ids: string[];
  /** Ids checked when the selector opens. */
  selectedIds: string[];
  theme: SettingsTheme;
  hideHint?: boolean;
  /** Called with the checked ids on Enter. */
  onSubmit: (ids: string[]) => void;
  /** Called on Esc; the caller's selection stays untouched. */
  onCancel: () => void;
}

/** Keep selection changes local until Enter; Esc leaves the mappings intact. */
export class ModelMultiSelector implements Component {
  private readonly selector: FuzzyMultiSelector;
  private readonly onSubmit: (ids: string[]) => void;
  private readonly onCancel: () => void;

  constructor(options: ModelMultiSelectorOptions) {
    this.selector = new FuzzyMultiSelector({
      label: options.title,
      items: options.ids.map((id) => ({
        label: id,
        checked: options.selectedIds.includes(id),
      })),
      theme: options.theme,
      hideHint: options.hideHint,
    });
    this.onSubmit = options.onSubmit;
    this.onCancel = options.onCancel;
  }

  render(width: number): string[] {
    return this.selector.render(width);
  }

  invalidate(): void {
    this.selector.invalidate();
  }

  getShortcuts(): string {
    return `${this.selector.getShortcuts()} · Esc: back`;
  }

  handleInput(data: string): void {
    if (matchesKey(data, Key.escape)) {
      this.onCancel();
      return;
    }
    if (matchesKey(data, Key.enter)) {
      this.onSubmit(this.selector.getCheckedItems().map((item) => item.label));
      return;
    }
    this.selector.handleInput(data);
  }
}
