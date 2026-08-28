import { describe, expect, test } from "vitest";
import { configLoader } from "./loader";
import {
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  normalizeCapabilitiesMigration,
} from "./migration";

describe("config migrations", () => {
  test("001 migrates old providers and checks to proxy capability", () => {
    const result = legacyToV06Migration.run(
      {
        baseUrl: "http://gateway.test",
        providers: ["anthropic", "openai"],
        checkGatewayModels: ["anthropic"],
      },
      "/fake/path",
    );

    expect(result.providers).toBeUndefined();
    expect(result.checkGatewayModels).toBeUndefined();
    expect(result.proxy).toEqual({
      enabled: true,
      upstreamProviders: [
        { id: "anthropic", shouldCheckGatewayModels: true },
        { id: "openai", shouldCheckGatewayModels: false },
      ],
    });
    expect(result.onboardingDone).toBe(true);
  });

  test("001 maps apertureProvider to dedicated capability", () => {
    expect(
      legacyToV06Migration.run({ apertureProvider: true }, "/fake/path")
        .dedicated?.enabled,
    ).toBe(true);
    expect(
      legacyToV06Migration.run({ apertureProvider: false }, "/fake/path")
        .dedicated?.enabled,
    ).toBe(false);
  });

  test("002 converts mode to independent capability flags", () => {
    expect(
      modeToCapabilitiesMigration.run({ mode: "proxy" }, "/fake/path"),
    ).toMatchObject({
      proxy: { enabled: true },
      dedicated: { enabled: false },
    });
    expect(
      modeToCapabilitiesMigration.run({ mode: "dedicated" }, "/fake/path"),
    ).toMatchObject({
      proxy: { enabled: false },
      dedicated: { enabled: true },
    });
  });

  test("003 normalizes capability objects and removes cachedModels", () => {
    const result = normalizeCapabilitiesMigration.run(
      { dedicated: { cachedModels: [{ id: "old" }] } },
      "/fake/path",
    );

    expect(result.proxy).toEqual({ enabled: false, upstreamProviders: [] });
    expect(result.dedicated).toEqual({ enabled: true, providers: [] });
  });
});

describe("APERTURE_BASE_URL env override", () => {
  test("env overrides the resolved baseUrl and is normalized", async () => {
    process.env.APERTURE_BASE_URL = "gateway.test/v1/models";
    try {
      await configLoader.load();
      expect(configLoader.getConfig().baseUrl).toBe("http://gateway.test");
    } finally {
      delete process.env.APERTURE_BASE_URL;
    }
  });

  test("no env keeps the configured baseUrl", async () => {
    await configLoader.load();
    const { baseUrl } = configLoader.getConfig();
    expect(baseUrl).toBe(configLoader.getConfig().baseUrl);
  });
});
