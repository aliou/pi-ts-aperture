import type { SettingsTheme } from "@aliou/pi-utils-settings";
import { describe, expect, test, vi } from "vitest";
import { LocalProviderSelector } from "./local-provider-selector";

const theme = {
  label: (text: string) => text,
  value: (text: string) => text,
  hint: (text: string) => text,
  cursor: "> ",
} as SettingsTheme;

describe("LocalProviderSelector", () => {
  test("commits all checked providers only on Enter", () => {
    const submit = vi.fn();
    const cancel = vi.fn();
    const selector = new LocalProviderSelector(
      "Anthropic",
      ["anthropic", "openai"],
      ["anthropic"],
      theme,
      true,
      submit,
      cancel,
    );
    selector.handleInput("\x1b[B");
    selector.handleInput(" ");
    expect(submit).not.toHaveBeenCalled();
    selector.handleInput("\r");
    expect(submit).toHaveBeenCalledWith(["anthropic", "openai"]);
    expect(cancel).not.toHaveBeenCalled();
  });

  test("Esc cancels without committing", () => {
    const submit = vi.fn();
    const cancel = vi.fn();
    const selector = new LocalProviderSelector(
      "Anthropic",
      ["anthropic"],
      [],
      theme,
      true,
      submit,
      cancel,
    );
    selector.handleInput(" ");
    selector.handleInput("\x1b");
    expect(cancel).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });
});
