import { Value } from "typebox/value";
import { describe, expect, test } from "vitest";
import { ApertureClient } from "./client";
import {
  ApertureProviderConfigInfoSchema,
  ApertureProviderSchema,
  ConnectorInfoSchema,
} from "./types";

const DEFAULT_URL = "http://ai";
const url = process.env.APERTURE_TEST_URL || DEFAULT_URL;

async function isAccessible(target: string): Promise<boolean> {
  try {
    const res = await fetch(`${target}/api/providers`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const accessible = await isAccessible(url);

describe.skipIf(!accessible)("ApertureClient integration", () => {
  const client = new ApertureClient(url);

  test("providers() returns valid providers", async () => {
    const providers = await client.providers();

    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(Value.Check(ApertureProviderSchema, p)).toBe(true);
    }
  });

  test("providerConfigInfos() returns valid config infos", async () => {
    const infos = await client.providerConfigInfos();

    expect(infos.size).toBeGreaterThan(0);
    for (const [id, info] of infos) {
      expect(info.id).toBe(id);
      expect(Value.Check(ApertureProviderConfigInfoSchema, info)).toBe(true);
    }
  });

  test("connectors() returns valid connectors", async () => {
    const connectors = await client.connectors();

    expect(connectors.length).toBeGreaterThan(0);
    for (const c of connectors) {
      expect(Value.Check(ConnectorInfoSchema, c)).toBe(true);
    }
  });

  test("health() does not throw", async () => {
    await expect(client.health()).resolves.toBeUndefined();
  });
});
