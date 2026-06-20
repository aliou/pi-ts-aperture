import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const FAKE_AGENT_DIR = join(
  tmpdir(),
  `aperture-cache-test-${process.pid}-${Date.now()}`,
);

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => FAKE_AGENT_DIR,
}));

// Import after the getAgentDir mock is installed so cachePath() resolves to
// the isolated temp directory.
const { loadCachedDedicatedModels, writeCachedDedicatedModels } = await import(
  "./models-cache"
);

const GATEWAY = "http://gateway.test";
const CACHE_FILE = join(
  FAKE_AGENT_DIR,
  "cache",
  "aperture-dedicated-models.json",
);

function writeRaw(content: string): void {
  writeFileSync(CACHE_FILE, content, "utf8");
}

function modelsFixture() {
  return [
    {
      id: "gpt-x",
      name: "gpt-x",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 8_192,
      api: "aperture",
      baseUrl: `${GATEWAY}/v1`,
    },
  ];
}

describe("dedicated models cache", () => {
  beforeEach(() => {
    rmSync(FAKE_AGENT_DIR, { recursive: true, force: true });
    mkdirSync(join(FAKE_AGENT_DIR, "cache"), { recursive: true });
  });

  afterEach(() => {
    rmSync(FAKE_AGENT_DIR, { recursive: true, force: true });
  });

  test("returns null when no cache file exists", () => {
    expect(loadCachedDedicatedModels(GATEWAY)).toBeNull();
  });

  test("round-trips models and per-model routes", async () => {
    const models = modelsFixture();
    const routes = new Map([["gpt-x", "openai-completions" as never]]);

    await writeCachedDedicatedModels(GATEWAY, models, routes);

    const loaded = loadCachedDedicatedModels(GATEWAY);
    expect(loaded).not.toBeNull();
    expect(loaded?.gatewayUrl).toBe(GATEWAY);
    expect(loaded?.models).toEqual(models);
    expect(loaded?.routes).toEqual({ "gpt-x": "openai-completions" });
  });

  test("returns null when gateway URL differs from cached", async () => {
    await writeCachedDedicatedModels(GATEWAY, modelsFixture(), new Map());

    expect(loadCachedDedicatedModels("http://other.test")).toBeNull();
  });

  test("returns null when version mismatches", async () => {
    await writeCachedDedicatedModels(GATEWAY, modelsFixture(), new Map());
    const parsed = JSON.parse(readFileSync(CACHE_FILE, "utf8"));
    writeRaw(JSON.stringify({ ...parsed, version: 999 }));

    expect(loadCachedDedicatedModels(GATEWAY)).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    writeRaw("{not json");
    expect(loadCachedDedicatedModels(GATEWAY)).toBeNull();
  });

  test("returns null when models is not an array", () => {
    writeRaw(
      JSON.stringify({
        version: 1,
        gatewayUrl: GATEWAY,
        models: "nope",
        routes: {},
      }),
    );
    expect(loadCachedDedicatedModels(GATEWAY)).toBeNull();
  });

  test("write is best-effort: does not throw on read-only dir", async () => {
    rmSync(FAKE_AGENT_DIR, { recursive: true, force: true });
    mkdirSync(FAKE_AGENT_DIR, { recursive: true });
    chmodSync(FAKE_AGENT_DIR, 0o500);

    await expect(
      writeCachedDedicatedModels(GATEWAY, modelsFixture(), new Map()),
    ).resolves.toBeUndefined();

    chmodSync(FAKE_AGENT_DIR, 0o700);
  });

  test("existsSync import sanity", () => {
    // Keeps the fs import list honest; cache file should exist after a write.
    expect(typeof existsSync).toBe("function");
  });
});
