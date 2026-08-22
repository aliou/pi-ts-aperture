import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, test, vi } from "vitest";
import { AsyncEditor, type AsyncEditorLoaderContext } from "./async-editor";
import { SETTINGS_CONTENT_HEIGHT } from "./shared";

function stubComponent(shortcuts?: string): Component & {
  getShortcuts?: () => string | undefined;
} {
  return {
    render: () => ["stub"],
    invalidate: () => {},
    handleInput: () => {},
    ...(shortcuts !== undefined ? { getShortcuts: () => shortcuts } : {}),
  };
}

describe("AsyncEditor", () => {
  test("forwards hideHint to the loader so it reaches the produced editor", async () => {
    let received: AsyncEditorLoaderContext | undefined;
    new AsyncEditor({
      requestRender: () => {},
      hideHint: true,
      loader: async (_signal, ctx) => {
        received = ctx;
        return stubComponent();
      },
    });
    await vi.waitFor(() => expect(received).toBeDefined());
    expect(received?.hideHint).toBe(true);
  });

  test("forwards hideHint as false by default", async () => {
    let received: AsyncEditorLoaderContext | undefined;
    new AsyncEditor({
      requestRender: () => {},
      loader: async (_signal, ctx) => {
        received = ctx;
        return stubComponent();
      },
    });
    await vi.waitFor(() => expect(received).toBeDefined());
    expect(received?.hideHint).toBe(false);
  });

  test("getShortcuts delegates to the loaded editor", async () => {
    let done = false;
    const editor = new AsyncEditor({
      requestRender: () => {},
      loader: async () => {
        done = true;
        return stubComponent("Enter: confirm · Esc: cancel");
      },
    });
    // While loading, no shortcuts are exposed (host shows default controls).
    expect(editor.getShortcuts()).toBeUndefined();
    await vi.waitFor(() => expect(done).toBe(true));
    await vi.waitFor(() =>
      expect(editor.getShortcuts()).toBe("Enter: confirm · Esc: cancel"),
    );
  });
});

describe("SETTINGS_CONTENT_HEIGHT", () => {
  test("matches the registerSettingsCommand default (20)", () => {
    // registerApertureSettings passes this constant as contentHeight, and
    // every SettingsDetailEditor built by the tabs uses the same budget.
    // The library default is 20; if the library default changes, this test
    // forces an explicit decision here instead of a silent layout drift.
    expect(SETTINGS_CONTENT_HEIGHT).toBe(20);
  });
});
