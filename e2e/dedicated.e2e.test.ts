import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  Api,
  Model,
  Provider,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { isModelType } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, test } from "vitest";
import {
  DEDICATED_CLASSIFIER_MODELS,
  DEDICATED_MODELS,
  GATEWAY,
  isAccessible,
} from "./helpers";

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

describe.skipIf(!accessible)("dedicated provider e2e", () => {
  let provider: Provider;
  let models: Model<Api>[];
  let allModels: readonly Model<Api>[];

  beforeAll(async () => {
    await configLoader.load();
    expect(configLoader.getConfig().baseUrl).toBe(GATEWAY);

    provider = createDedicatedProvider(`${GATEWAY}/v1`, (context) =>
      refreshDedicatedCatalog(context, () => []),
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
    allModels = provider.getAllModels?.() ?? [];
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

  test.each(
    Object.entries(DEDICATED_CLASSIFIER_MODELS),
  )("classifies %s/%s", async (providerId, modelId) => {
    const classifier = allModels.find(
      (m) => m.id === `${providerId}/${modelId}`,
    );
    expect(
      classifier,
      `catalog does not contain ${providerId}/${modelId}`,
    ).toBeDefined();
    expect(
      classifier && isModelType(classifier, "classifier"),
      `${providerId}/${modelId} is not a classifier model`,
    ).toBe(true);
    if (!classifier || !isModelType(classifier, "classifier")) return;
    expect(classifier.api).toBe("typesafe-system-one");
    expect(models.map((m) => m.id)).not.toContain(classifier.id);

    const result = await provider.classify?.(
      classifier,
      {
        state: {},
        questions: {
          topic: {
            type: "choice",
            instructions: "Classify the support ticket.",
            criteria: {
              billing: "Invoices, payments, or refunds.",
              other: "Anything else.",
            },
          },
        },
      },
      { apiKey: "-" },
    );

    expect(result?.stopReason).toBe("stop");
    expect(result?.answers.topic).toMatchObject({
      type: "choice",
      choice: expect.stringMatching(/^billing|other$/u),
      confidence: expect.any(Number),
    });
    expect(result?.usage?.totalTokens).toBeGreaterThan(0);
  });
});
