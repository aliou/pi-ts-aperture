/**
 * End-to-end tests for pi-ts-aperture using RPC mode.
 *
 * Spawns the real PI CLI in RPC mode and verifies that:
 * 1. Models are correctly enumerated without aperture
 * 2. After configuring aperture in override mode, the same models are still present
 * 3. Model metadata is preserved through the override
 * 4. In provider mode, the "aperture" provider is registered with models from /v1/models
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { withPiCli } from "./pi-cli";

/** Paths derived from the per-test temp root. */
function testPaths(root: string) {
  const extensionsDir = join(root, "extensions");
  const testProviderDir = join(extensionsDir, "pi-test-provider");
  const testProviderEntry = join(testProviderDir, "index.ts");
  const agentDir = join(root, ".pi", "agent");
  const apertureConfigDir = join(agentDir, "extensions");
  const apertureConfigPath = join(apertureConfigDir, "aperture.json");
  return {
    extensionsDir,
    testProviderDir,
    testProviderEntry,
    apertureConfigDir,
    apertureConfigPath,
  };
}

/** Scaffold a minimal test-provider extension that registers 2 models. */
function setupTestProvider(dir: string, entry: string) {
  mkdirSync(dir, { recursive: true });

  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "pi-test-provider",
      version: "0.0.0",
      type: "module",
      exports: "./index.ts",
    }),
  );

  writeFileSync(
    entry,
    `export default async function (pi) {
  pi.registerProvider("test-provider", {
    baseUrl: "https://test.example.com/v1",
    apiKey: "TEST_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: "test-model-1",
        name: "Test Model 1",
        reasoning: false,
        input: ["text"],
        cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 16384,
      },
      {
        id: "test-model-2",
        name: "Test Model 2",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 2, output: 2, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 32768,
      },
    ],
  });
}`,
  );
}

function writeApertureConfig(
  configDir: string,
  configPath: string,
  cfg: {
    mode?: "override" | "provider";
    baseUrl: string;
    providers?: string[];
    checkGatewayModels?: string[];
  },
) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      mode: cfg.mode ?? "override",
      baseUrl: cfg.baseUrl,
      providers: cfg.providers ?? [],
      checkGatewayModels: cfg.checkGatewayModels ?? [],
    }),
  );
}

/**
 * Start a throwaway HTTP server that serves a fixed /v1/models response.
 * Returns the base URL (e.g. "http://127.0.0.1:12345") and a stop() hook.
 */
async function startMockGateway(body: unknown): Promise<{
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// ---------------------------------------------------------------------------

describe("pi-ts-aperture e2e", () => {
  let testRoot: string;
  let paths: ReturnType<typeof testPaths>;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    testRoot = mkdtempSync(join(tmpdir(), "pi-aperture-e2e-"));
    paths = testPaths(testRoot);

    // Isolate config writes to the temp directory.
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(testRoot, ".pi", "agent");

    // Ensure PI doesn't fail on missing API keys.
    process.env.OPENROUTER_API_KEY ??= "sk-test-openrouter";
    process.env.ANTHROPIC_API_KEY ??= "sk-test-anthropic";
    process.env.OPENAI_API_KEY ??= "sk-test-openai";

    setupTestProvider(paths.testProviderDir, paths.testProviderEntry);
  });

  afterEach(() => {
    if (originalAgentDir !== undefined) {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    } else {
      delete process.env.PI_CODING_AGENT_DIR;
    }
    rmSync(testRoot, { recursive: true, force: true });
  });

  const aperturePath = join(process.cwd(), "src", "index.ts");

  test("enumerates models without aperture", async () => {
    const models = await withPiCli(
      { extensionPaths: [paths.testProviderEntry] },
      (cli) => cli.listModels(),
    );

    const testModels = models.filter((m) => m.provider === "test-provider");
    expect(testModels).toHaveLength(2);
    expect(testModels.map((m) => m.id)).toContain("test-model-1");
    expect(testModels.map((m) => m.id)).toContain("test-model-2");
  });

  test("preserves models when aperture overrides the provider", async () => {
    writeApertureConfig(paths.apertureConfigDir, paths.apertureConfigPath, {
      mode: "override",
      baseUrl: "http://aperture.test",
      providers: ["test-provider"],
    });

    const models = await withPiCli(
      { extensionPaths: [paths.testProviderEntry, aperturePath] },
      (cli) => cli.listModels(),
    );

    const testModels = models.filter((m) => m.provider === "test-provider");
    expect(testModels).toHaveLength(2);
    expect(testModels.map((m) => m.id)).toContain("test-model-1");
    expect(testModels.map((m) => m.id)).toContain("test-model-2");
  });

  test("leaves non-targeted providers untouched", async () => {
    writeApertureConfig(paths.apertureConfigDir, paths.apertureConfigPath, {
      mode: "override",
      baseUrl: "http://aperture.test",
      providers: ["anthropic"], // only anthropic, not test-provider
    });

    const models = await withPiCli(
      { extensionPaths: [paths.testProviderEntry, aperturePath] },
      (cli) => cli.listModels(),
    );

    const testModels = models.filter((m) => m.provider === "test-provider");
    expect(testModels).toHaveLength(2);

    const providers = new Set(models.map((m) => m.provider));
    expect(providers.has("test-provider")).toBe(true);
  });

  test("preserves model metadata through aperture override", async () => {
    writeApertureConfig(paths.apertureConfigDir, paths.apertureConfigPath, {
      mode: "override",
      baseUrl: "http://aperture.test",
      providers: ["test-provider"],
    });

    const models = await withPiCli(
      { extensionPaths: [paths.testProviderEntry, aperturePath] },
      (cli) => cli.listModels(),
    );

    const model1 = models.find(
      (m) => m.id === "test-model-1" && m.provider === "test-provider",
    );
    expect(model1).toBeDefined();
    expect(model1?.reasoning).toBe(false);

    const model2 = models.find(
      (m) => m.id === "test-model-2" && m.provider === "test-provider",
    );
    expect(model2).toBeDefined();
    expect(model2?.reasoning).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Provider mode: aperture registers itself as a standalone provider, with
  // models discovered from GET <baseUrl>/v1/models on the gateway.
  // -------------------------------------------------------------------------

  test("provider mode registers 'aperture' with models from /v1/models", async () => {
    const gateway = await startMockGateway({
      object: "list",
      data: [
        {
          id: "anthropic/claude-haiku-4.5",
          object: "model",
          owned_by: "ts-llm-proxy",
          pricing: {
            input: "0.00000100",
            output: "0.00000500",
            input_cache_read: "0.00000010",
            input_cache_write: "0.00000125",
          },
        },
        {
          id: "hf:openai/gpt-oss-120b",
          object: "model",
          owned_by: "ts-llm-proxy",
        },
      ],
    });

    try {
      writeApertureConfig(paths.apertureConfigDir, paths.apertureConfigPath, {
        mode: "provider",
        baseUrl: gateway.baseUrl,
      });

      const models = await withPiCli(
        { extensionPaths: [paths.testProviderEntry, aperturePath] },
        (cli) => cli.listModels(),
      );

      const apertureModels = models.filter((m) => m.provider === "aperture");
      expect(apertureModels.map((m) => m.id).sort()).toEqual([
        "anthropic/claude-haiku-4.5",
        "hf:openai/gpt-oss-120b",
      ]);

      // The test-provider's own models must still be intact -- aperture in
      // provider mode never touches other providers.
      const testModels = models.filter((m) => m.provider === "test-provider");
      expect(testModels).toHaveLength(2);
    } finally {
      await gateway.stop();
    }
  });

  test("provider mode does not override existing providers", async () => {
    const gateway = await startMockGateway({
      object: "list",
      data: [{ id: "gateway-only-model", object: "model" }],
    });

    try {
      writeApertureConfig(paths.apertureConfigDir, paths.apertureConfigPath, {
        mode: "provider",
        baseUrl: gateway.baseUrl,
        // Even if the user left a stale providers list, provider mode ignores it.
        providers: ["test-provider"],
      });

      const models = await withPiCli(
        { extensionPaths: [paths.testProviderEntry, aperturePath] },
        (cli) => cli.listModels(),
      );

      const testProviderModel = models.find(
        (m) => m.id === "test-model-1" && m.provider === "test-provider",
      );
      expect(testProviderModel).toBeDefined();
      // The test-provider registered its own baseUrl; provider mode must not
      // have rewritten it.
      expect(testProviderModel?.baseUrl).toBe("https://test.example.com/v1");
    } finally {
      await gateway.stop();
    }
  });

  test("provider mode: gateway returning no models skips registration", async () => {
    const gateway = await startMockGateway({ object: "list", data: [] });

    try {
      writeApertureConfig(paths.apertureConfigDir, paths.apertureConfigPath, {
        mode: "provider",
        baseUrl: gateway.baseUrl,
      });

      const models = await withPiCli(
        { extensionPaths: [paths.testProviderEntry, aperturePath] },
        (cli) => cli.listModels(),
      );

      expect(models.filter((m) => m.provider === "aperture")).toHaveLength(0);
    } finally {
      await gateway.stop();
    }
  });
});
