import type { SettingsTheme } from "@aliou/pi-utils-settings";
import { describe, expect, test, vi } from "vitest";
import { ApertureClient } from "../../../src/api/client";
import { DEFAULT_CONFIG } from "../../shared/config/defaults";
import type {
  ApertureConfig,
  ResolvedConfig,
} from "../../shared/config/loader";
import { buildProxyTab } from "./proxy-tab";

const theme = {
  label: (text: string) => text,
  value: (text: string) => text,
  description: (text: string) => text,
  hint: (text: string) => text,
  cursor: "> ",
} as SettingsTheme;

const gateway = (id: string, name: string) => ({
  id,
  name,
  description: "",
  models: [],
  compatibility: { openai_chat: true },
});

const model = (provider: string) => ({
  id: "model",
  name: "model",
  api: "openai-completions" as const,
  provider,
  baseUrl: "https://example.com",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
});

function setup() {
  const providers = vi
    .spyOn(ApertureClient.prototype, "providers")
    .mockResolvedValue([
      gateway("google", "Google AI Studio"),
      gateway("anthropic-oauth", "Anthropic"),
    ]);
  let draft: ApertureConfig = {
    proxy: { enabled: true, upstreamProviders: [] },
  };
  const tab = buildProxyTab(() => [model("google"), model("anthropic")]);
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
  if (!item?.submenu) throw new Error("Missing provider submenu");
  const editor = item.submenu("", () => {}, {
    requestRender: () => {},
    hideHint: true,
  });
  return { editor, getDraft: () => draft, providers };
}

describe("Proxy provider settings", () => {
  test("unmatched gateway goes straight to multi-select, then settings", async () => {
    const { editor, getDraft, providers } = setup();
    try {
      await vi.waitFor(() =>
        expect(editor.render(80).join("\n")).toContain("Anthropic"),
      );
      expect(editor.render(80).join("\n")).toMatch(/Anthropic\s+› select/);
      editor.handleInput?.("\r");
      expect(editor.render(80).join("\n")).toContain(
        "Local Pi providers for Anthropic",
      );
      expect(editor.render(80).join("\n")).not.toContain("Proxy this provider");
      editor.handleInput?.(" ");
      editor.handleInput?.("\r");
      expect(editor.render(80).join("\n")).toContain("Proxy this provider");
      expect(getDraft().proxy?.upstreamProviders).toMatchObject([
        { id: "anthropic", gatewayId: "anthropic-oauth", enabled: true },
      ]);
    } finally {
      providers.mockRestore();
    }
  });

  test("exact match opens settings without enabling routing on option edits", async () => {
    const { editor, getDraft, providers } = setup();
    try {
      await vi.waitFor(() =>
        expect(editor.render(80).join("\n")).toContain("Google AI Studio"),
      );
      editor.handleInput?.("\x1b[B");
      editor.handleInput?.("\r");
      expect(editor.render(80).join("\n")).toContain("Proxy this provider");
      editor.handleInput?.("\x1b[B");
      editor.handleInput?.("\x1b[B");
      editor.handleInput?.("\r");
      expect(getDraft().proxy?.upstreamProviders).toMatchObject([
        {
          id: "google",
          gatewayId: "google",
          enabled: false,
          shouldCheckGatewayModels: false,
        },
      ]);
    } finally {
      providers.mockRestore();
    }
  });

  test("multiple local providers keep independent routing settings", async () => {
    const { editor, getDraft, providers } = setup();
    try {
      await vi.waitFor(() =>
        expect(editor.render(80).join("\n")).toContain("Anthropic"),
      );
      editor.handleInput?.("\r");
      editor.handleInput?.(" ");
      editor.handleInput?.("\x1b[B");
      editor.handleInput?.(" ");
      editor.handleInput?.("\r");
      expect(editor.render(80).join("\n")).toContain("Local Pi providers");
      expect(editor.render(80).join("\n")).toContain("anthropic");
      expect(editor.render(80).join("\n")).toContain("google");
      editor.handleInput?.("\x1b[B");
      editor.handleInput?.("\r");
      expect(editor.render(80).join("\n")).toContain("Proxy this provider");
      editor.handleInput?.("\r");
      expect(getDraft().proxy?.upstreamProviders).toMatchObject([
        { id: "anthropic", enabled: false },
        { id: "google", enabled: true },
      ]);
    } finally {
      providers.mockRestore();
    }
  });
});
