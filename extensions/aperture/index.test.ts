/**
 * Gating tests for provenance header injection (`before_provider_headers`).
 * Headers are injected only when both the `shouldSendProvenanceHeaders`
 * config option (default true) and pi's telemetry gate (`PI_TELEMETRY` /
 * pi's `enableInstallTelemetry` setting) allow it.
 *
 * The config loader is mocked (per repo convention); settings files are
 * faked through a vi.mock'd readFileSync, so no test ever touches disk.
 */
import { join } from "node:path";
import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  config: {
    baseUrl: "https://aperture.test",
    shouldSendProvenanceHeaders: true,
    onboardingDone: true,
    onboarding: { enabled: false },
    proxy: { enabled: false, upstreamProviders: [] },
    dedicated: { enabled: false, providers: [] },
    connectors: { enabled: false, pinnedTools: [], discoveryTools: true },
  },
  /** Fake settings files, keyed by path; real fs used for everything else. */
  fakeFiles: new Map<string, string>(),
}));

vi.mock("../shared/config/loader", () => ({
  configLoader: {
    load: () => {},
    getConfig: () => mocks.config,
    getRawConfig: () => mocks.config,
  },
}));

// Fake settings files without touching disk: hits return from the map,
// everything else (including package reads at import time) delegates.
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  const originalReadFileSync = original.readFileSync as (
    path: unknown,
    options?: unknown,
  ) => unknown;
  const mocked = {
    ...original,
    readFileSync: (path: unknown, options?: unknown) => {
      const content = mocks.fakeFiles.get(String(path));
      return content !== undefined
        ? content
        : originalReadFileSync(path, options);
    },
  };
  return { ...mocked, default: mocked };
});

import { resetProvenanceTelemetryCache } from "../shared/provenance";
import factory from "./index";

type HeaderHandler = (
  event: { type: string; headers: Record<string, string> },
  ctx: unknown,
) => unknown;

const SESSION_ID = "test-session-id";

interface SetupOptions {
  piGlobalSettings?: Record<string, unknown>;
}

/** Run the factory, fire the header hook, collect injected headers. */
async function collectInjectedHeaders(
  options: SetupOptions = {},
): Promise<Record<string, string>> {
  if (options.piGlobalSettings) {
    mocks.fakeFiles.set(
      join(getAgentDir(), "settings.json"),
      JSON.stringify(options.piGlobalSettings),
    );
  }

  const handlers = new Map<string, HeaderHandler[]>();
  const pi = new Proxy(
    {
      on: (event: string, handler: HeaderHandler) => {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      events: { on: () => {}, emit: () => {} },
    },
    { get: (t, p, r) => (p in t ? Reflect.get(t, p, r) : () => {}) },
  );
  await factory(pi as unknown as ExtensionAPI);

  const headers: Record<string, string> = {};
  const ctx = { sessionManager: { getSessionId: () => SESSION_ID } };
  for (const handler of handlers.get("before_provider_headers") ?? []) {
    await handler({ type: "before_provider_headers", headers }, ctx);
  }
  return headers;
}

let savedTelemetry: string | undefined;

beforeEach(() => {
  savedTelemetry = process.env.PI_TELEMETRY;
  delete process.env.PI_TELEMETRY;
  mocks.config.shouldSendProvenanceHeaders = true;
  // Default: an empty global settings file (telemetry gate open), so the
  // real global settings on this machine can't leak into a test.
  mocks.fakeFiles.clear();
  mocks.fakeFiles.set(join(getAgentDir(), "settings.json"), "{}");
  resetProvenanceTelemetryCache();
});

afterEach(() => {
  if (savedTelemetry === undefined) delete process.env.PI_TELEMETRY;
  else process.env.PI_TELEMETRY = savedTelemetry;
});

describe("before_provider_headers gating", () => {
  test("injects Referer + x-session-id by default", async () => {
    const headers = await collectInjectedHeaders();
    expect(headers.Referer).toBe("https://pi.dev");
    expect(headers["x-session-id"]).toBe(SESSION_ID);
  });

  test("shouldSendProvenanceHeaders: false disables injection", async () => {
    mocks.config.shouldSendProvenanceHeaders = false;
    const headers = await collectInjectedHeaders();
    expect(headers.Referer).toBeUndefined();
    expect(headers["x-session-id"]).toBeUndefined();
  });

  test("PI_TELEMETRY=0 skips headers even when the config flag is on", async () => {
    process.env.PI_TELEMETRY = "0";
    const headers = await collectInjectedHeaders();
    expect(headers.Referer).toBeUndefined();
    expect(headers["x-session-id"]).toBeUndefined();
  });

  test("follows pi settings; PI_TELEMETRY env wins over them", async () => {
    const optedOut = await collectInjectedHeaders({
      piGlobalSettings: { enableInstallTelemetry: false },
    });
    expect(optedOut.Referer).toBeUndefined();

    process.env.PI_TELEMETRY = "1";
    resetProvenanceTelemetryCache();
    const envWins = await collectInjectedHeaders({
      piGlobalSettings: { enableInstallTelemetry: false },
    });
    expect(envWins.Referer).toBe("https://pi.dev");
    expect(envWins["x-session-id"]).toBe(SESSION_ID);
  });
});
