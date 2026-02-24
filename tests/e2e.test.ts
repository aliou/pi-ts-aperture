/**
 * End-to-end tests for pi-ts-aperture.
 *
 * Spawns the real PI CLI and verifies that:
 * 1. Models are correctly enumerated without aperture
 * 2. After configuring aperture, the same models are still present
 * 3. Model metadata is preserved through the override
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  baseUrl: string,
  providers: string[],
) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({ baseUrl, providers }));
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

    // Avoid npm permission issues in temp dirs.
    process.env.NPM_CONFIG_PREFIX = join(testRoot, "npm-global");
    mkdirSync(process.env.NPM_CONFIG_PREFIX, { recursive: true });

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
    writeApertureConfig(
      paths.apertureConfigDir,
      paths.apertureConfigPath,
      "http://aperture.test",
      ["test-provider"],
    );

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
    writeApertureConfig(
      paths.apertureConfigDir,
      paths.apertureConfigPath,
      "http://aperture.test",
      ["anthropic"], // only anthropic, not test-provider
    );

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
    writeApertureConfig(
      paths.apertureConfigDir,
      paths.apertureConfigPath,
      "http://aperture.test",
      ["test-provider"],
    );

    const models = await withPiCli(
      { extensionPaths: [paths.testProviderEntry, aperturePath] },
      (cli) => cli.listModels(),
    );

    const model1 = models.find(
      (m) => m.id === "test-model-1" && m.provider === "test-provider",
    );
    expect(model1).toBeDefined();
    expect(model1?.thinking).toBe("no");

    const model2 = models.find(
      (m) => m.id === "test-model-2" && m.provider === "test-provider",
    );
    expect(model2).toBeDefined();
    expect(model2?.thinking).toBe("yes");
  });
});
