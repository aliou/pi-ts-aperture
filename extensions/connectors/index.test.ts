// Loaded from its own source through pi's real extension loader: real
// registry, real event bus, real config loader. The only fakes are the
// throwaway PI_CODING_AGENT_DIR and a rival extension file, both on disk.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEventBus,
  discoverAndLoadExtensions,
  ExtensionRunner,
} from "@earendil-works/pi-coding-agent";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import {
  APERTURE_FEATURE_REGISTER_EVENT,
  APERTURE_FEATURE_REQUEST_EVENT,
} from "../shared/events";

const EXTENSION_PATH = fileURLToPath(new URL("./index.ts", import.meta.url));

const agentDir = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aperture-connectors-"));
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
});

afterAll(() => {
  rmSync(agentDir, { recursive: true, force: true });
  delete process.env.PI_CODING_AGENT_DIR;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const CONFIG_PATH = join(agentDir, "extensions", "aperture.json");

function writeConfig(config: Record<string, unknown>): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config));
}

async function load(extraPaths: string[] = []) {
  const eventBus = createEventBus();
  const result = await discoverAndLoadExtensions(
    [...extraPaths, EXTENSION_PATH],
    process.cwd(),
    agentDir,
    eventBus,
  );
  return {
    runtime: result.runtime,
    eventBus,
    extensions: result.extensions,
    errors: result.errors,
  };
}

describe("connectors extension", () => {
  test("registers the gateway MCP server at load with deferred exposure", async () => {
    writeConfig({
      baseUrl: "https://ai.pango-lin.ts.net",
      connectors: { enabled: true },
    });

    const { runtime, errors } = await load();

    expect(errors).toEqual([]);
    expect(runtime.mcpServers.get("aperture")?.config).toMatchObject({
      url: "https://ai.pango-lin.ts.net/v1/mcp",
      exposure: "deferred",
    });
  });

  test("normalizes a trailing slash in a hand-edited base URL", async () => {
    writeConfig({
      baseUrl: "https://ai.pango-lin.ts.net/",
      connectors: { enabled: true },
    });

    const { runtime, errors } = await load();

    expect(errors).toEqual([]);
    expect(runtime.mcpServers.get("aperture")?.config).toMatchObject({
      url: "https://ai.pango-lin.ts.net/v1/mcp",
    });
  });

  test("derives the registration URL from the APERTURE_BASE_URL override", async () => {
    writeConfig({
      baseUrl: "https://ai.pango-lin.ts.net",
      connectors: { enabled: true },
    });
    vi.stubEnv(
      "APERTURE_BASE_URL",
      "https://aperture.example.ts.net/v1/models",
    );

    const { runtime } = await load();

    expect(runtime.mcpServers.get("aperture")?.config).toMatchObject({
      url: "https://aperture.example.ts.net/v1/mcp",
    });
  });

  test("registers nothing when connectors are disabled", async () => {
    writeConfig({
      baseUrl: "https://ai.pango-lin.ts.net",
      connectors: { enabled: false },
    });

    const { runtime, errors } = await load();

    expect(errors).toEqual([]);
    expect(runtime.mcpServers.list()).toEqual([]);
  });

  test("registers nothing without a base URL", async () => {
    writeConfig({ connectors: { enabled: true } });

    const { runtime, errors } = await load();

    expect(errors).toEqual([]);
    expect(runtime.mcpServers.list()).toEqual([]);
  });

  test("unregisters the server when the runner dispatches session_shutdown", async () => {
    writeConfig({
      baseUrl: "https://ai.pango-lin.ts.net",
      connectors: { enabled: true },
    });
    const { runtime, extensions, errors } = await load();
    expect(errors).toEqual([]);
    expect(runtime.mcpServers.list()).toHaveLength(1);
    const runner = new ExtensionRunner(
      extensions,
      runtime,
      process.cwd(),
      { getSessionId: () => "s1" } as never,
      { getAll: () => [] } as never,
    );

    await runner.emit({ type: "session_shutdown" } as never);

    expect(runtime.mcpServers.list()).toEqual([]);
  });

  test("announces the connectors feature over the real event bus", async () => {
    writeConfig({
      baseUrl: "https://ai.pango-lin.ts.net",
      connectors: { enabled: true },
    });
    const { eventBus, errors } = await load();
    expect(errors).toEqual([]);
    const received: unknown[] = [];
    eventBus.on(APERTURE_FEATURE_REGISTER_EVENT, (data) => received.push(data));

    eventBus.emit(APERTURE_FEATURE_REQUEST_EVENT, {});

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      source: "aperture",
      feature: { id: "connectors" },
    });
  });

  test("fails to load when another extension already owns the name", async () => {
    writeConfig({
      baseUrl: "https://ai.pango-lin.ts.net",
      connectors: { enabled: true },
    });
    const rival = join(agentDir, "rival.ts");
    writeFileSync(
      rival,
      `export default function (pi) { pi.registerMcpServer("aperture", { url: "https://elsewhere.example/mcp" }); }`,
    );

    const { runtime, errors } = await load([rival]);

    expect(runtime.mcpServers.get("aperture")?.config).toMatchObject({
      url: "https://elsewhere.example/mcp",
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe(EXTENSION_PATH);
    expect(errors[0].error).toContain(
      'MCP server "aperture" is already registered',
    );
  });
});
