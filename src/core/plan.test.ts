import { describe, expect, it } from "vitest";
import {
  APERTURE_MODEL_DEFAULTS,
  APERTURE_PROVENANCE_HEADERS,
  buildApertureProviderPlan,
  buildApplyPlan,
  planConfigChange,
  resolveProviderHeaders,
} from "./plan";
import type {
  ApertureConfig,
  ApertureRegistrationState,
  Api,
  GatewayModelInfo,
  Model,
} from "./types";
import { APERTURE_PROVIDER_NAME } from "./types";

const cfg = (overrides: Partial<ApertureConfig>): ApertureConfig => ({
  mode: "override",
  baseUrl: "https://aperture.example.com",
  providers: ["openai", "anthropic"],
  checkGatewayModels: [],
  ...overrides,
});

describe("resolveProviderHeaders", () => {
  it("includes provenance headers", () => {
    const models: Model<Api>[] = [{ id: "gpt-4", provider: "openai" }];
    const headers = resolveProviderHeaders(models);
    expect(headers).toMatchObject(APERTURE_PROVENANCE_HEADERS);
  });

  it("merges model headers when present", () => {
    const models: Model<Api>[] = [
      { id: "gpt-4", provider: "openai", headers: { "X-Custom": "value" } },
    ];
    const headers = resolveProviderHeaders(models);
    expect(headers).toEqual({
      ...APERTURE_PROVENANCE_HEADERS,
      "X-Custom": "value",
    });
  });

  it("model headers take precedence over provenance headers", () => {
    const models: Model<Api>[] = [
      { id: "gpt-4", provider: "openai", headers: { Referer: "custom" } },
    ];
    const headers = resolveProviderHeaders(models);
    expect(headers.Referer).toBe("custom");
  });

  it("uses first model with headers", () => {
    const models: Model<Api>[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai", headers: { "X-Auth": "token" } },
      { id: "gpt-4o", provider: "openai", headers: { "X-Other": "other" } },
    ];
    const headers = resolveProviderHeaders(models);
    expect(headers["X-Auth"]).toBe("token");
    expect(headers["X-Other"]).toBeUndefined();
  });

  it("returns only provenance headers when no model has headers", () => {
    const models: Model<Api>[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai" },
    ];
    const headers = resolveProviderHeaders(models);
    expect(headers).toEqual(APERTURE_PROVENANCE_HEADERS);
  });
});

describe("buildApplyPlan", () => {
  const baseUrl = "https://aperture.example.com/v1";

  it("returns empty registrations for empty config", () => {
    const config = cfg({ baseUrl: "", providers: [] });
    const plan = buildApplyPlan(config, [], baseUrl, []);
    expect(plan.registrations).toEqual([]);
    expect(plan.missingModels).toEqual([]);
  });

  it("skips providers with no models in registry", () => {
    const registryModels: Model<Api>[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.registrations).toHaveLength(1);
    expect(plan.registrations[0].provider).toBe("openai");
  });

  it("creates registrations for configured providers with models", () => {
    const registryModels: Model<Api>[] = [
      { id: "gpt-4", provider: "openai", api: "openai-completions" },
      { id: "claude-3", provider: "anthropic", api: "anthropic-messages" },
    ];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.registrations).toHaveLength(2);
    expect(plan.registrations.map((r) => r.provider)).toContain("openai");
    expect(plan.registrations.map((r) => r.provider)).toContain("anthropic");
  });

  it("registration has correct baseUrl", () => {
    const registryModels: Model<Api>[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.registrations[0].baseUrl).toBe(baseUrl);
  });

  it("registration has apiKey set to dash", () => {
    const registryModels: Model<Api>[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.registrations[0].apiKey).toBe("-");
  });

  it("registration includes merged headers", () => {
    const registryModels: Model<Api>[] = [
      { id: "gpt-4", provider: "openai", headers: { "X-Custom": "value" } },
    ];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.registrations[0].headers).toEqual({
      ...APERTURE_PROVENANCE_HEADERS,
      "X-Custom": "value",
    });
  });

  it("registration uses first model's api", () => {
    const registryModels: Model<Api>[] = [
      { id: "gpt-4", provider: "openai", api: "openai-completions" },
      { id: "gpt-3", provider: "openai", api: "openai-chat" },
    ];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.registrations[0].api).toBe("openai-completions");
  });

  it("registration defaults api when not specified", () => {
    const registryModels: Model<Api>[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.registrations[0].api).toBe("openai-completions");
  });

  it("registration includes all models for provider", () => {
    const registryModels: Model<Api>[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai" },
      { id: "gpt-4o", provider: "openai" },
    ];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.registrations[0].models).toHaveLength(3);
  });

  it("computes missing models when gateway IDs provided", () => {
    const registryModels: Model<Api>[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai" },
    ];
    const gatewayIds = ["gpt-4"];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, gatewayIds);
    expect(plan.missingModels).toEqual(["gpt-3"]);
  });

  it("missingModels is empty when gateway IDs empty", () => {
    const registryModels: Model<Api>[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, []);
    expect(plan.missingModels).toEqual([]);
  });

  it("missingModels is empty when all models present on gateway", () => {
    const registryModels: Model<Api>[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai" },
    ];
    const gatewayIds = ["gpt-4", "gpt-3"];
    const plan = buildApplyPlan(cfg({}), registryModels, baseUrl, gatewayIds);
    expect(plan.missingModels).toEqual([]);
  });

  it("only checks missing models for configured providers", () => {
    const config = cfg({ providers: ["openai"] });
    const registryModels: Model<Api>[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "claude-3", provider: "anthropic" },
    ];
    const plan = buildApplyPlan(config, registryModels, baseUrl, []);
    // Only openai models are considered, but since gatewayIds is empty, missingModels is empty
    expect(plan.missingModels).toEqual([]);
  });
});

describe("buildApertureProviderPlan", () => {
  const baseUrl = "https://aperture.example.com/v1";

  it("returns null when gateway returns no models", () => {
    expect(buildApertureProviderPlan(baseUrl, [])).toBeNull();
  });

  it("creates a single aperture registration", () => {
    const models: GatewayModelInfo[] = [{ id: "foo" }, { id: "bar" }];
    const reg = buildApertureProviderPlan(baseUrl, models);
    expect(reg).not.toBeNull();
    expect(reg?.provider).toBe(APERTURE_PROVIDER_NAME);
    expect(reg?.baseUrl).toBe(baseUrl);
    expect(reg?.apiKey).toBe("-");
    expect(reg?.api).toBe("openai-completions");
    expect(reg?.headers).toEqual(APERTURE_PROVENANCE_HEADERS);
  });

  it("includes one Model<Api> per gateway entry", () => {
    const models: GatewayModelInfo[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const reg = buildApertureProviderPlan(baseUrl, models);
    expect(reg?.models).toHaveLength(3);
    expect(reg?.models.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("defaults Model.name to id when gateway provides none", () => {
    const reg = buildApertureProviderPlan(baseUrl, [{ id: "foo" }]);
    expect((reg?.models[0] as { name?: string }).name).toBe("foo");
  });

  it("uses gateway-provided name when present", () => {
    const reg = buildApertureProviderPlan(baseUrl, [
      { id: "foo", name: "Foo Model" },
    ]);
    expect((reg?.models[0] as { name?: string }).name).toBe("Foo Model");
  });

  it("stamps provider name onto every model", () => {
    const reg = buildApertureProviderPlan(baseUrl, [{ id: "a" }, { id: "b" }]);
    for (const m of reg?.models ?? []) {
      expect(m.provider).toBe(APERTURE_PROVIDER_NAME);
    }
  });

  it("propagates gateway-sourced fields verbatim", () => {
    const reg = buildApertureProviderPlan(baseUrl, [
      {
        id: "rich",
        contextWindow: 128000,
        maxTokens: 16384,
        input: ["text", "image"],
        reasoning: true,
        cost: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
      },
    ]);
    const m = reg?.models[0];
    expect(m?.contextWindow).toBe(128000);
    expect(m?.maxTokens).toBe(16384);
    expect(m?.input).toEqual(["text", "image"]);
    expect(m?.reasoning).toBe(true);
    expect(m?.cost).toEqual({
      input: 1,
      output: 5,
      cacheRead: 0.1,
      cacheWrite: 1.25,
    });
  });

  it("fills required Model fields with safe defaults when gateway stays silent", () => {
    const reg = buildApertureProviderPlan(baseUrl, [{ id: "bare" }]);
    const m = reg?.models[0];
    expect(m?.contextWindow).toBe(APERTURE_MODEL_DEFAULTS.contextWindow);
    expect(m?.maxTokens).toBe(APERTURE_MODEL_DEFAULTS.maxTokens);
    expect(m?.input).toEqual([...APERTURE_MODEL_DEFAULTS.input]);
    expect(m?.reasoning).toBe(APERTURE_MODEL_DEFAULTS.reasoning);
    expect(m?.cost).toEqual(APERTURE_MODEL_DEFAULTS.cost);
    expect(m?.api).toBe(APERTURE_MODEL_DEFAULTS.api);
    expect(m?.baseUrl).toBe(baseUrl);
  });

  it("merges partial gateway cost with defaults for missing dimensions", () => {
    const reg = buildApertureProviderPlan(baseUrl, [
      { id: "partial", cost: { input: 3, output: 15 } },
    ]);
    expect(reg?.models[0].cost).toEqual({
      input: 3,
      output: 15,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  it("sanitizes unknown input modalities down to the literal type", () => {
    const reg = buildApertureProviderPlan(baseUrl, [
      { id: "weird", input: ["text", "audio", "video", "image"] as string[] },
    ]);
    expect(reg?.models[0].input).toEqual(["text", "image"]);
  });

  it("falls back to ['text'] when the gateway emits only unknown modalities", () => {
    const reg = buildApertureProviderPlan(baseUrl, [
      { id: "x", input: ["audio"] as string[] },
    ]);
    expect(reg?.models[0].input).toEqual(["text"]);
  });

  it("lets gateway override the api wire protocol", () => {
    const reg = buildApertureProviderPlan(baseUrl, [
      { id: "weird", api: "anthropic-messages" },
    ]);
    expect(reg?.models[0].api).toBe("anthropic-messages");
  });
});

describe("planConfigChange", () => {
  const override = (providers: string[]): ApertureRegistrationState => ({
    mode: "override",
    providers,
  });
  const provider = (): ApertureRegistrationState => ({
    mode: "provider",
    providers: [],
  });

  it("detects removed providers in override mode", () => {
    const plan = planConfigChange(
      override(["openai", "anthropic"]),
      override(["openai"]),
    );
    expect(plan.removedProviders).toEqual(["anthropic"]);
  });

  it("returns empty removedProviders when no providers removed", () => {
    const plan = planConfigChange(
      override(["openai", "anthropic"]),
      override(["openai", "anthropic", "google"]),
    );
    expect(plan.removedProviders).toEqual([]);
  });

  it("returns empty removedProviders when providers unchanged", () => {
    const plan = planConfigChange(
      override(["openai", "anthropic"]),
      override(["openai", "anthropic"]),
    );
    expect(plan.removedProviders).toEqual([]);
  });

  it("detects all providers removed in override mode", () => {
    const plan = planConfigChange(
      override(["openai", "anthropic"]),
      override([]),
    );
    expect(plan.removedProviders).toEqual(["openai", "anthropic"]);
  });

  it("shouldRefreshModel is true when active model provider is in next providers", () => {
    const plan = planConfigChange(
      override(["openai"]),
      override(["openai", "anthropic"]),
      "openai",
    );
    expect(plan.shouldRefreshModel).toBe(true);
  });

  it("shouldRefreshModel is false when active model provider was removed", () => {
    const plan = planConfigChange(
      override(["openai", "anthropic"]),
      override(["openai"]),
      "anthropic",
    );
    expect(plan.shouldRefreshModel).toBe(false);
  });

  it("shouldRefreshModel is false when no active model", () => {
    const plan = planConfigChange(
      override(["openai"]),
      override(["openai", "anthropic"]),
    );
    expect(plan.shouldRefreshModel).toBe(false);
  });

  it("shouldRefreshModel is true when adding provider that matches active model", () => {
    const plan = planConfigChange(override([]), override(["openai"]), "openai");
    expect(plan.shouldRefreshModel).toBe(true);
  });

  it("shouldRefreshModel is false when active model provider not in next", () => {
    const plan = planConfigChange(
      override(["openai"]),
      override(["anthropic"]),
      "openai",
    );
    expect(plan.shouldRefreshModel).toBe(false);
  });

  it("switching override -> provider removes all former override providers", () => {
    const plan = planConfigChange(
      override(["openai", "anthropic"]),
      provider(),
    );
    expect(plan.removedProviders.sort()).toEqual(["anthropic", "openai"]);
  });

  it("switching provider -> override removes the 'aperture' provider", () => {
    const plan = planConfigChange(provider(), override(["openai"]));
    expect(plan.removedProviders).toEqual([APERTURE_PROVIDER_NAME]);
  });

  it("provider -> provider is a no-op for removals", () => {
    const plan = planConfigChange(provider(), provider());
    expect(plan.removedProviders).toEqual([]);
  });

  it("shouldRefreshModel is true in provider mode when active model is 'aperture'", () => {
    const plan = planConfigChange(
      provider(),
      provider(),
      APERTURE_PROVIDER_NAME,
    );
    expect(plan.shouldRefreshModel).toBe(true);
  });
});
