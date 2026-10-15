import type { SettingsTheme } from "@aliou/pi-utils-settings";
import { describe, expect, test, vi } from "vitest";
import { ApertureClient } from "../../../src/api/client";
import { DEFAULT_CONFIG } from "../../shared/config/defaults";
import type {
  ApertureConfig,
  ResolvedConfig,
} from "../../shared/config/loader";
import { buildDedicatedTab } from "./dedicated-tab";

const theme = {
  label: (text: string) => text,
  value: (text: string) => text,
  description: (text: string) => text,
  hint: (text: string) => text,
  cursor: "> ",
} as SettingsTheme;

const gateway = (id: string, name: string, models: string[]) => ({
  id,
  name,
  description: "",
  models,
  compatibility: { openai_chat: true },
  modelInfoById: Object.fromEntries(
    models.map((m) => [m, { id: m, system_one: true, chat: true }]),
  ),
});

function setup(existing: ApertureConfig["dedicated"] = { providers: [] }) {
  const providers = vi
    .spyOn(ApertureClient.prototype, "providers")
    .mockResolvedValue([
      gateway("neuralwatt", "Neuralwatt", ["clef-flash", "kimi-k3"]),
      gateway("typesafe", "TypeSafe", ["jev-latest"]),
    ]);
  let draft: ApertureConfig = { dedicated: existing };
  const tab = buildDedicatedTab();
  const sections = tab.buildSections({
    resolved: DEFAULT_CONFIG as ResolvedConfig,
    setDraftForScope: (_scope, value) => {
      draft = value;
    },
    getDraftForScope: () => draft,
    getRawForScope: () => null,
    enabledScopes: ["global"],
    theme,
  });
  const item = sections[0]?.items[1];
  if (!item?.submenu) throw new Error("Missing providers submenu");
  const editor = item.submenu("", () => {}, {
    requestRender: () => {},
    hideHint: true,
  });
  return { editor, getDraft: () => draft, providers };
}

describe("Dedicated provider settings", () => {
  test("provider rows open the include toggle and api override", async () => {
    const { editor, providers } = setup();
    try {
      await vi.waitFor(() =>
        expect(editor.render(80).join("\n")).toContain("Neuralwatt"),
      );
      // Open the first provider's settings.
      editor.handleInput?.("\r");
      const rendered = editor.render(80).join("\n");
      expect(rendered).toContain("Include provider");
      expect(rendered).not.toContain("Classifier models");
    } finally {
      providers.mockRestore();
    }
  });
});
