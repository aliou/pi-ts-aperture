import type { SettingsTheme } from "@aliou/pi-utils-settings";
import { describe, expect, test } from "vitest";
import { FilterableChecklist } from "./filterable-checklist";

/** Identity theme: renders raw text so tests can assert on content. */
const theme = {
  label: (text: string) => text,
  value: (text: string) => text,
  description: (text: string) => text,
  cursor: "> ",
  hint: (text: string) => text,
} as unknown as SettingsTheme;

const items = [
  { id: "github_list_repos", label: "github_list_repos", checked: false },
  { id: "github_create_issue", label: "github_create_issue", checked: true },
];

describe("FilterableChecklist", () => {
  test("getShortcuts returns the footer-equivalent string", () => {
    const checklist = new FilterableChecklist(
      theme,
      items,
      () => {},
      undefined,
      () => {},
    );
    expect(checklist.getShortcuts()).toBe(
      "↑↓: navigate · Space: toggle · Esc: back",
    );
  });

  test("getShortcuts includes the Ctrl+G hint when a handler is bound", () => {
    const checklist = new FilterableChecklist(
      theme,
      items,
      () => {},
      () => {},
      () => {},
    );
    expect(checklist.getShortcuts()).toBe(
      "↑↓: navigate · Space: toggle · Ctrl+G: gateway check · Esc: back",
    );
  });

  test("getShortcuts omits optional hints in the onboarding shape", () => {
    const checklist = new FilterableChecklist(theme, items, () => {});
    expect(checklist.getShortcuts()).toBe("↑↓: navigate · Space: toggle");
  });

  test("footer hint line matches getShortcuts by default", () => {
    const checklist = new FilterableChecklist(
      theme,
      items,
      () => {},
      undefined,
      () => {},
    );
    const lines = checklist.render(80);
    expect(lines.at(-1)).toBe(`  ${checklist.getShortcuts()}`);
  });

  test("hideHint: true removes the footer hint line", () => {
    const checklist = new FilterableChecklist(
      theme,
      items,
      () => {},
      undefined,
      () => {},
      true,
    );
    const lines = checklist.render(80);
    expect(lines.some((line) => line.includes("Space: toggle"))).toBe(false);
  });

  test("hideHint keeps the extra hint (context cost warning)", () => {
    const checklist = new FilterableChecklist(
      theme,
      items,
      () => {},
      undefined,
      () => {},
      true,
    );
    checklist.setExtraHint("warning: high context cost");
    const lines = checklist.render(80);
    expect(lines.some((line) => line.includes("Space: toggle"))).toBe(false);
    expect(
      lines.some((line) => line.includes("warning: high context cost")),
    ).toBe(true);
  });

  test("default rendering is unchanged (onboarding regression)", () => {
    const checklist = new FilterableChecklist(theme, items, () => {});
    const lines = checklist.render(80);
    // Search input, blank, two items, blank, footer hint.
    expect(lines.at(-1)).toBe("  ↑↓: navigate · Space: toggle");
    expect(lines.at(-2)).toBe("");
    expect(lines.some((line) => line.includes("[ ] github_list_repos"))).toBe(
      true,
    );
    expect(lines.some((line) => line.includes("[x] github_create_issue"))).toBe(
      true,
    );
  });
});
