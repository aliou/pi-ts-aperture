import { describe, expect, test } from "vitest";
import { legacyMigration } from "./migration";

describe("legacy migration", () => {
  test("migrates old providers and checkGatewayModels to proxy.upstreamProviders", () => {
    const old = {
      baseUrl: "http://gateway.test",
      providers: ["anthropic", "openai"],
      checkGatewayModels: ["anthropic"],
    };

    const result = legacyMigration.run(old, "/fake/path");

    expect(result.providers).toBeUndefined();
    expect(result.checkGatewayModels).toBeUndefined();
    expect(result.proxy).toEqual({
      upstreamProviders: [
        { id: "anthropic", shouldCheckGatewayModels: true },
        { id: "openai", shouldCheckGatewayModels: false },
      ],
    });
    expect(result.mode).toBe("proxy");
    expect(result.onboardingDone).toBe(true);
  });

  test("migrates apertureProvider=true to dedicated mode", () => {
    const old = {
      baseUrl: "http://gateway.test",
      apertureProvider: true,
    };

    const result = legacyMigration.run(old, "/fake/path");

    expect(result.apertureProvider).toBeUndefined();
    expect(result.mode).toBe("dedicated");
  });

  test("migrates apertureProvider=false to proxy mode", () => {
    const old = {
      baseUrl: "http://gateway.test",
      apertureProvider: false,
    };

    const result = legacyMigration.run(old, "/fake/path");

    expect(result.apertureProvider).toBeUndefined();
    expect(result.mode).toBe("proxy");
  });

  test("sets onboardingDone=true when baseUrl exists but onboardingDone is missing", () => {
    const old = {
      baseUrl: "http://gateway.test",
      mode: "dedicated" as const,
    };

    const result = legacyMigration.run(old, "/fake/path");

    expect(result.onboardingDone).toBe(true);
  });

  test("does not override existing onboardingDone", () => {
    const old = {
      baseUrl: "http://gateway.test",
      onboardingDone: false,
    };

    const result = legacyMigration.run(old, "/fake/path");

    expect(result.onboardingDone).toBe(false);
  });

  test("shouldRun returns true for legacy config with providers", () => {
    expect(legacyMigration.shouldRun({ providers: ["anthropic"] })).toBe(true);
  });

  test("shouldRun returns true for legacy config with checkGatewayModels", () => {
    expect(
      legacyMigration.shouldRun({ checkGatewayModels: ["anthropic"] }),
    ).toBe(true);
  });

  test("shouldRun returns true for config with baseUrl but no onboardingDone", () => {
    expect(legacyMigration.shouldRun({ baseUrl: "http://test" })).toBe(true);
  });

  test("shouldRun returns false for fully migrated config", () => {
    expect(
      legacyMigration.shouldRun({
        baseUrl: "http://test",
        mode: "dedicated",
        onboardingDone: true,
        proxy: { upstreamProviders: [] },
        dedicated: { providers: [] },
      }),
    ).toBe(false);
  });

  test("ensures proxy object exists when mode is proxy", () => {
    const old = {
      baseUrl: "http://gateway.test",
      mode: "proxy" as const,
      providers: ["anthropic"],
    };

    const result = legacyMigration.run(old, "/fake/path");

    expect(result.proxy).toBeDefined();
    expect(result.proxy?.upstreamProviders).toBeDefined();
  });

  test("ensures dedicated object exists", () => {
    const old = {
      baseUrl: "http://gateway.test",
      apertureProvider: true,
    };

    const result = legacyMigration.run(old, "/fake/path");

    expect(result.dedicated).toEqual({ providers: [], cachedModels: [] });
  });
});
