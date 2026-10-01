import { describe, expect, test } from "vitest";
import { configLoader } from "./loader";
import {
  gatewayIdMigration,
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  nativeMcpConnectorsMigration,
  normalizeCapabilitiesMigration,
} from "./migration";
import type {
  PreV17Config,
  V17Config,
} from "./migration/005-native-mcp-connectors";

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

  test("004 fills missing gateway ids and leaves complete entries alone", () => {
    const incomplete = {
      proxy: {
        upstreamProviders: [
          { id: "anthropic" },
          { id: "openai", gatewayId: "custom" },
        ],
      },
    };
    expect(gatewayIdMigration.shouldRun(incomplete)).toBe(true);
    expect(
      gatewayIdMigration.run(incomplete, "/fake/path").proxy?.upstreamProviders,
    ).toEqual([
      { id: "anthropic", gatewayId: "anthropic" },
      { id: "openai", gatewayId: "custom" },
    ]);
    expect(
      gatewayIdMigration.shouldRun(
        gatewayIdMigration.run(incomplete, "/fake/path"),
      ),
    ).toBe(false);
  });

  describe("005 drops connector pin/discovery config", () => {
    const base: PreV17Config = {
      baseUrl: "http://gateway.test",
      proxy: { enabled: true, upstreamProviders: [] },
      dedicated: { enabled: true, providers: [] },
    };
    const cases: {
      name: string;
      connectors: NonNullable<PreV17Config["connectors"]>;
      expectedShouldRun: boolean;
    }[] = [
      {
        name: "pinned tools set",
        connectors: {
          enabled: true,
          pinnedTools: [
            { connectorId: "github", toolName: "github_list_repos" },
          ],
        },
        expectedShouldRun: true,
      },
      {
        name: "discovery tools set",
        connectors: { enabled: true, discoveryTools: false },
        expectedShouldRun: true,
      },
      {
        name: "both set",
        connectors: {
          enabled: false,
          pinnedTools: [],
          discoveryTools: true,
        },
        expectedShouldRun: true,
      },
      {
        name: "neither set",
        connectors: { enabled: true },
        expectedShouldRun: false,
      },
    ];

    for (const { name, connectors, expectedShouldRun } of cases) {
      test(name, () => {
        const pre: PreV17Config = { ...base, connectors };
        expect(nativeMcpConnectorsMigration.shouldRun(pre)).toBe(
          expectedShouldRun,
        );
        const post: V17Config = nativeMcpConnectorsMigration.run(
          pre,
          "/fake/path",
        );
        expect(post.connectors).toEqual({ enabled: connectors.enabled });
        // Other top-level config passes through untouched.
        expect(post.baseUrl).toBe(base.baseUrl);
        expect(post.proxy).toEqual(base.proxy);
        expect(post.dedicated).toEqual(base.dedicated);
        expect(nativeMcpConnectorsMigration.shouldRun(post)).toBe(false);
      });
    }
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
