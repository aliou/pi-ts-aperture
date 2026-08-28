import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Provider } from "@earendil-works/pi-ai";
import { beforeAll, describe, expect, test } from "vitest";
import { GATEWAY, isAccessible, PROXY_MODELS } from "./helpers";

// The config loader singleton resolves ~/.pi/agent at import time: point HOME
// at a scratch dir, write a proxy-enabled config, and set APERTURE_BASE_URL
// before importing it.
const home = mkdtempSync(join(tmpdir(), "pi-aperture-e2e-"));
process.env.HOME = home;
const extensionsDir = join(home, ".pi", "agent", "extensions");
mkdirSync(extensionsDir, { recursive: true });
writeFileSync(
  join(extensionsDir, "aperture.json"),
  JSON.stringify({
    baseUrl: GATEWAY,
    proxy: {
      enabled: true,
      upstreamProviders: Object.keys(PROXY_MODELS).map((id) => ({ id })),
    },
  }),
);

const { registerSyntheticProvider } = await import(
  "@aliou/pi-synthetic/extensions/provider/index.ts"
);
const { createNeuralwattProvider } = await import(
  "@aliou/pi-neuralwatt/extensions/provider/provider.ts"
);
const { buildNeuralwattProviderModels } = await import(
  "@aliou/pi-neuralwatt/extensions/provider/models/catalog.ts"
);
const { ApertureRuntime } = await import(
  "../extensions/aperture/proxy/runtime"
);
const { configLoader } = await import("../extensions/shared/config/loader");

const locals: Provider[] = [];
registerSyntheticProvider({
  registerProvider: (p: Provider) => locals.push(p),
} as never);
locals.push(
  createNeuralwattProvider(buildNeuralwattProviderModels(), async () => {
    throw new Error("model refresh is not exercised in e2e");
  }),
);

const accessible = await isAccessible(GATEWAY);

describe.skipIf(!accessible)("proxy mode e2e", () => {
  const registered: Provider[] = [];

  beforeAll(async () => {
    await configLoader.load();
    expect(configLoader.getConfig().proxy.enabled).toBe(true);

    const byId = new Map(locals.map((p) => [p.id, p]));
    await new ApertureRuntime().sync({
      getProvider: (id) => byId.get(id),
      registerNativeProvider: (p) => registered.push(p),
      getModels: () => locals.flatMap((p) => p.getModels()),
    });
  });

  test.each(
    Object.entries(PROXY_MODELS),
  )("proxies %s via %s", async (providerId, modelId) => {
    const wrapped = registered.find((p) => p.id === providerId);
    expect(
      wrapped,
      `${providerId} was not wrapped by the runtime`,
    ).toBeDefined();
    if (!wrapped) return;

    const model = wrapped.getModels().find((m) => m.id === modelId);
    expect(model, `wrapped ${providerId} lost model ${modelId}`).toBeDefined();
    if (!model) return;

    // Both upstreams end in /v1, so the gateway base stays gateway/v1.
    expect(model.baseUrl).toBe(`${GATEWAY}/v1`);

    // Routing-focused: drop reasoning params some upstreams reject.
    const streamModel = {
      ...model,
      reasoning: false,
      thinkingLevelMap: undefined,
    };
    const stream = wrapped.streamSimple(
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
