import {
  FuzzyMultiSelector,
  type SettingsTheme,
} from "@aliou/pi-utils-settings";
import type { Component } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";

/** Keep selection changes local until Enter; Esc leaves the mappings intact. */
export class LocalProviderSelector implements Component {
  private readonly selector: FuzzyMultiSelector;

  constructor(
    label: string,
    localIds: string[],
    selectedIds: string[],
    theme: SettingsTheme,
    hideHint: boolean,
    private readonly onSubmit: (ids: string[]) => void,
    private readonly onCancel: () => void,
  ) {
    this.selector = new FuzzyMultiSelector({
      label: `Local Pi providers for ${label}`,
      items: localIds.map((id) => ({
        label: id,
        checked: selectedIds.includes(id),
      })),
      theme,
      hideHint,
    });
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
