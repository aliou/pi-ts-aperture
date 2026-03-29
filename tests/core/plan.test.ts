import { describe, expect, it } from "vitest";
import {
  APERTURE_PROVENANCE_HEADERS,
  buildApplyPlan,
  planConfigChange,
  resolveProviderHeaders,
} from "../../src/core/plan";
import type { ApertureConfig, ModelInfo } from "../../src/core/types";

describe("resolveProviderHeaders", () => {
  it("includes provenance headers", () => {
    const models: ModelInfo[] = [{ id: "gpt-4", provider: "openai" }];
    const headers = resolveProviderHeaders(models);
    expect(headers).toMatchObject(APERTURE_PROVENANCE_HEADERS);
  });

  it("merges model headers when present", () => {
    const models: ModelInfo[] = [
      { id: "gpt-4", provider: "openai", headers: { "X-Custom": "value" } },
    ];
    const headers = resolveProviderHeaders(models);
    expect(headers).toEqual({
      ...APERTURE_PROVENANCE_HEADERS,
      "X-Custom": "value",
    });
  });

  it("model headers take precedence over provenance headers", () => {
    const models: ModelInfo[] = [
      { id: "gpt-4", provider: "openai", headers: { Referer: "custom" } },
    ];
    const headers = resolveProviderHeaders(models);
    expect(headers.Referer).toBe("custom");
  });

  it("uses first model with headers", () => {
    const models: ModelInfo[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai", headers: { "X-Auth": "token" } },
      { id: "gpt-4o", provider: "openai", headers: { "X-Other": "other" } },
    ];
    const headers = resolveProviderHeaders(models);
    expect(headers["X-Auth"]).toBe("token");
    expect(headers["X-Other"]).toBeUndefined();
  });

  it("returns only provenance headers when no model has headers", () => {
    const models: ModelInfo[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai" },
    ];
    const headers = resolveProviderHeaders(models);
    expect(headers).toEqual(APERTURE_PROVENANCE_HEADERS);
  });
});

describe("buildApplyPlan", () => {
  const baseConfig: ApertureConfig = {
    baseUrl: "https://aperture.example.com",
    providers: ["openai", "anthropic"],
  };

  const baseUrl = "https://aperture.example.com/v1";

  it("returns empty registrations for empty config", () => {
    const config: ApertureConfig = { baseUrl: "", providers: [] };
    const plan = buildApplyPlan(config, [], baseUrl, []);
    expect(plan.registrations).toEqual([]);
    expect(plan.missingModels).toEqual([]);
  });

  it("skips providers with no models in registry", () => {
    const registryModels: ModelInfo[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.registrations).toHaveLength(1);
    expect(plan.registrations[0].provider).toBe("openai");
  });

  it("creates registrations for configured providers with models", () => {
    const registryModels: ModelInfo[] = [
      { id: "gpt-4", provider: "openai", api: "openai-completions" },
      { id: "claude-3", provider: "anthropic", api: "anthropic-messages" },
    ];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.registrations).toHaveLength(2);
    expect(plan.registrations.map((r) => r.provider)).toContain("openai");
    expect(plan.registrations.map((r) => r.provider)).toContain("anthropic");
  });

  it("registration has correct baseUrl", () => {
    const registryModels: ModelInfo[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.registrations[0].baseUrl).toBe(baseUrl);
  });

  it("registration has apiKey set to dash", () => {
    const registryModels: ModelInfo[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.registrations[0].apiKey).toBe("-");
  });

  it("registration includes merged headers", () => {
    const registryModels: ModelInfo[] = [
      { id: "gpt-4", provider: "openai", headers: { "X-Custom": "value" } },
    ];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.registrations[0].headers).toEqual({
      ...APERTURE_PROVENANCE_HEADERS,
      "X-Custom": "value",
    });
  });

  it("registration uses first model's api", () => {
    const registryModels: ModelInfo[] = [
      { id: "gpt-4", provider: "openai", api: "openai-completions" },
      { id: "gpt-3", provider: "openai", api: "openai-chat" },
    ];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.registrations[0].api).toBe("openai-completions");
  });

  it("registration defaults api when not specified", () => {
    const registryModels: ModelInfo[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.registrations[0].api).toBe("openai-completions");
  });

  it("registration includes all models for provider", () => {
    const registryModels: ModelInfo[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai" },
      { id: "gpt-4o", provider: "openai" },
    ];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.registrations[0].models).toHaveLength(3);
  });

  it("computes missing models when gateway IDs provided", () => {
    const registryModels: ModelInfo[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai" },
    ];
    const gatewayIds = ["gpt-4"];
    const plan = buildApplyPlan(
      baseConfig,
      registryModels,
      baseUrl,
      gatewayIds,
    );
    expect(plan.missingModels).toEqual(["gpt-3"]);
  });

  it("missingModels is empty when gateway IDs empty", () => {
    const registryModels: ModelInfo[] = [{ id: "gpt-4", provider: "openai" }];
    const plan = buildApplyPlan(baseConfig, registryModels, baseUrl, []);
    expect(plan.missingModels).toEqual([]);
  });

  it("missingModels is empty when all models present on gateway", () => {
    const registryModels: ModelInfo[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "gpt-3", provider: "openai" },
    ];
    const gatewayIds = ["gpt-4", "gpt-3"];
    const plan = buildApplyPlan(
      baseConfig,
      registryModels,
      baseUrl,
      gatewayIds,
    );
    expect(plan.missingModels).toEqual([]);
  });

  it("only checks missing models for configured providers", () => {
    const config: ApertureConfig = {
      baseUrl: "https://aperture.example.com",
      providers: ["openai"],
    };
    const registryModels: ModelInfo[] = [
      { id: "gpt-4", provider: "openai" },
      { id: "claude-3", provider: "anthropic" },
    ];
    const gatewayIds: string[] = [];
    const plan = buildApplyPlan(config, registryModels, baseUrl, gatewayIds);
    // Only openai models are considered, but since gatewayIds is empty, missingModels is empty
    expect(plan.missingModels).toEqual([]);
  });
});

describe("planConfigChange", () => {
  it("detects removed providers", () => {
    const prev = ["openai", "anthropic"];
    const next = ["openai"];
    const plan = planConfigChange(prev, next);
    expect(plan.removedProviders).toEqual(["anthropic"]);
  });

  it("returns empty removedProviders when no providers removed", () => {
    const prev = ["openai", "anthropic"];
    const next = ["openai", "anthropic", "google"];
    const plan = planConfigChange(prev, next);
    expect(plan.removedProviders).toEqual([]);
  });

  it("returns empty removedProviders when providers unchanged", () => {
    const prev = ["openai", "anthropic"];
    const next = ["openai", "anthropic"];
    const plan = planConfigChange(prev, next);
    expect(plan.removedProviders).toEqual([]);
  });

  it("detects all providers removed", () => {
    const prev = ["openai", "anthropic"];
    const next: string[] = [];
    const plan = planConfigChange(prev, next);
    expect(plan.removedProviders).toEqual(["openai", "anthropic"]);
  });

  it("shouldRefreshModel is true when active model provider is in next providers", () => {
    const prev = ["openai"];
    const next = ["openai", "anthropic"];
    const plan = planConfigChange(prev, next, "openai");
    expect(plan.shouldRefreshModel).toBe(true);
  });

  it("shouldRefreshModel is false when active model provider was removed", () => {
    const prev = ["openai", "anthropic"];
    const next = ["openai"];
    const plan = planConfigChange(prev, next, "anthropic");
    expect(plan.shouldRefreshModel).toBe(false);
  });

  it("shouldRefreshModel is false when no active model", () => {
    const prev = ["openai"];
    const next = ["openai", "anthropic"];
    const plan = planConfigChange(prev, next);
    expect(plan.shouldRefreshModel).toBe(false);
  });

  it("shouldRefreshModel is true when adding provider that matches active model", () => {
    const prev: string[] = [];
    const next = ["openai"];
    const plan = planConfigChange(prev, next, "openai");
    expect(plan.shouldRefreshModel).toBe(true);
  });

  it("shouldRefreshModel is false when active model provider not in next", () => {
    const prev = ["openai"];
    const next = ["anthropic"];
    const plan = planConfigChange(prev, next, "openai");
    expect(plan.shouldRefreshModel).toBe(false);
  });
});
