import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, test } from "vitest";
import type { ApertureProvider } from "../../../src/api/types";
import { buildProxyRows } from "./proxy-upstream-editor";

function model(provider: string, id: string): Model<Api> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider,
    baseUrl: `https://${provider}.example.com/v1`,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function gatewayProvider(id: string): ApertureProvider {
  return {
    id,
    name: id,
    description: "",
    models: [`${id}-model`],
    compatibility: { openai_chat: true },
  };
}

describe("buildProxyRows", () => {
  test("includes unmatched local providers as unmapped rows (non-admin case)", () => {
    // Non-admin: no provider config info (403 on /aperture/config). The
    // gateway names its Anthropic provider `claude`, not `anthropic`, so the
    // Pi `anthropic` provider does not auto-match. It must still appear as a
    // row so the user can manually map it.
    const localModels = [
      model("anthropic", "claude-3-5-sonnet"),
      model("openai-codex", "gpt-5.5"),
    ];
    const gatewayProviders = [gatewayProvider("claude")];

    const { entries, autoMatchUnavailable } = buildProxyRows(
      localModels,
      gatewayProviders,
      new Map(),
      [],
      true,
    );

    expect(autoMatchUnavailable).toBe(true);
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("anthropic");
    expect(ids).toContain("openai-codex");

    // The unmatched locals appear as unmapped candidate rows.
    const anthropic = entries.find((e) => e.id === "anthropic");
    expect(anthropic).toMatchObject({
      id: "anthropic",
      apertureProviderId: undefined,
      automatic: false,
      existsLocally: true,
      enabled: false,
    });
  });

  test("auto-matched providers keep their target and enabled reflects persisted config", () => {
    const localModels = [model("anthropic", "claude-3-5-sonnet")];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const { entries } = buildProxyRows(
      localModels,
      gatewayProviders,
      new Map(),
      [
        {
          id: "anthropic",
          apertureProviderId: "anthropic",
          shouldCheckGatewayModels: true,
        },
      ],
      false,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "anthropic",
      apertureProviderId: "anthropic",
      automatic: true,
      enabled: true,
    });
  });

  test("persisted manual mapping is present and unmapped locals are appended", () => {
    const localModels = [
      model("openrouter", "or-1"),
      model("openai-codex", "gpt-5.5"),
    ];
    const gatewayProviders = [gatewayProvider("anthropic")];

    const { entries } = buildProxyRows(
      localModels,
      gatewayProviders,
      new Map(),
      [
        {
          id: "openrouter",
          apertureProviderId: "anthropic",
          shouldCheckGatewayModels: true,
        },
      ],
      true,
    );

    // openrouter is a manual mapping (persisted); openai-codex is an
    // unmatched local (no gateway provider matches its id, no config base
    // URLs) appended as an unmapped candidate row.
    expect(entries.map((e) => e.id)).toEqual(["openai-codex", "openrouter"]);
    expect(entries.find((e) => e.id === "openrouter")).toMatchObject({
      apertureProviderId: "anthropic",
      automatic: false,
      enabled: true,
    });
    expect(entries.find((e) => e.id === "openai-codex")).toMatchObject({
      apertureProviderId: undefined,
      automatic: false,
      enabled: false,
    });
  });
});
