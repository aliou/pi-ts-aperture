import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Api,
  Model,
  Provider,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, test } from "vitest";
import { DEDICATED_MODELS, GATEWAY, isAccessible } from "./helpers";

// The config loader singleton resolves ~/.pi/agent at import time: point HOME
// at a scratch dir and set APERTURE_BASE_URL before importing it.
process.env.HOME = mkdtempSync(join(tmpdir(), "pi-aperture-e2e-"));
process.env.APERTURE_BASE_URL = GATEWAY;

const { configLoader } = await import("../extensions/shared/config/loader");
const { createDedicatedProvider } = await import(
  "../extensions/aperture/dedicated/provider"
);
const { refreshDedicatedCatalog } = await import(
  "../extensions/aperture/dedicated/runtime"
);

const accessible = await isAccessible(GATEWAY);

// Stand-in for Pi's native registry: supplies the zai upstream base URL the
// gateway-root inference needs (ends in /v4, so the gateway root is used).
const registryModels = [
  {
    id: "glm-5.3",
    provider: "zai",
    api: "openai-completions",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    reasoning: true,
    input: ["text"],
    contextWindow: 1_000_000,
    maxTokens: 65_536,
  },
] as Model<Api>[];

describe.skipIf(!accessible)("dedicated provider e2e", () => {
  let provider: Provider;
  let models: Model<Api>[];

  beforeAll(async () => {
    await configLoader.load();
    expect(configLoader.getConfig().baseUrl).toBe(GATEWAY);

    provider = createDedicatedProvider(`${GATEWAY}/v1`, (context) =>
      refreshDedicatedCatalog(context, () => registryModels),
    );

    const context = {
      allowNetwork: true,
      force: true,
      signal: new AbortController().signal,
      publish: async (publication: { update?: () => void }) => {
        publication.update?.();
        return true;
      },
    } as unknown as RefreshModelsContext;

    await provider.refreshModels?.(context);
    models = provider.getModels();
  });

  test("refresh publishes a provider-qualified catalog under the gateway", () => {
    expect(models.length).toBeGreaterThan(0);

    for (const model of models) {
      expect(model.id).toMatch(/^[^/]+\//);
      expect(model.provider).toBe("aperture");
      expect(model.baseUrl?.startsWith(GATEWAY)).toBe(true);
    }
  });

  test.each(
    Object.entries(DEDICATED_MODELS),
  )("streams %s/%s", async (providerId, modelId) => {
    const target = models.find((m) => m.id === `${providerId}/${modelId}`);
    expect(
      target,
      `catalog does not contain ${providerId}/${modelId}`,
    ).toBeDefined();
    if (!target) return;

    // Routing-focused: drop reasoning params and stamp registry-shaped
    // compat (strict upstreams 422 on store/max_completion_tokens).
    const streamModel = {
      ...target,
      reasoning: false,
      thinkingLevelMap: undefined,
      compat: {
        ...target.compat,
        supportsStore: false,
        maxTokensField: "max_tokens",
      },
    };
    const stream = provider.streamSimple(
      streamModel,
      {
        messages: [
          {
            role: "user",
            content: "Reply with exactly: OK",
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey: "-", maxTokens: 1024 },
    );

    const result = await stream.result();
    expect(
      result.errorMessage ?? "",
      `stream failed: ${result.errorMessage}`,
    ).toBe("");
    expect(result.stopReason).toBe("stop");
    expect(
      result.content.filter((block) => block.type !== "toolcall").length,
    ).toBeGreaterThan(0);
  });
});
