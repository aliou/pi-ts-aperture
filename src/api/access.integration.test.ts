import { describe, expect, test } from "vitest";
import { ApertureClient } from "./client";

const DEFAULT_URL = "http://ai";
const url = process.env.APERTURE_TEST_URL || DEFAULT_URL;

async function isAccessible(target: string): Promise<boolean> {
  try {
    const res = await fetch(`${target}/v1/models`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const accessible = await isAccessible(url);

// Guards the gateway surface the extension depends on. Meant to run with a
// role: user identity so an access regression on any of these endpoints is
// caught before users hit it.
describe.skipIf(!accessible)("Aperture access", () => {
  test("every /v1/models entry carries provider metadata and supported endpoints", async () => {
    const res = await fetch(`${url}/v1/models`);
    expect(res.ok).toBe(true);
    const json = await res.json();
    const body = json as { data?: Record<string, unknown>[] };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    for (const entry of body.data) {
      const metadata = entry.metadata as
        | { provider?: { id?: unknown } }
        | undefined;
      expect(metadata?.provider?.id, `model ${String(entry.id)}`).toBeTruthy();
      expect(
        Array.isArray(entry.supported_endpoints) &&
          entry.supported_endpoints.length > 0,
        `model ${String(entry.id)}`,
      ).toBe(true);
    }
  });

  test("providers() discovers the enabled providers", async () => {
    const providers = await new ApertureClient(url).providers();
    expect(providers.length).toBeGreaterThan(0);

    for (const provider of providers) {
      console.log(
        `${provider.id}: ${provider.models.length} models, compatibility ${JSON.stringify(provider.compatibility)}`,
      );
      expect(provider.models.length).toBeGreaterThan(0);
      expect(Object.keys(provider.compatibility).length).toBeGreaterThan(0);
    }
  });

  test("the MCP endpoint accepts an initialize handshake", async () => {
    const res = await fetch(`${url}/v1/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "aperture-access-check", version: "0" },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    expect(res.ok).toBe(true);
  });
});
