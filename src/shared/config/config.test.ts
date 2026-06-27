import { describe, expect, test } from "vitest";
import { normalizeProxiedProviders } from "./loader";
import {
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  normalizeCapabilitiesMigration,
  proxyProviderApertureIdMigration,
} from "./migration";
import type { ApertureConfig, ResolvedConfig } from "./types";

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

  test("004 backfills apertureProviderId = id when missing", () => {
    expect(
      proxyProviderApertureIdMigration.shouldRun({
        proxy: {
          upstreamProviders: [
            { id: "anthropic", shouldCheckGatewayModels: true },
          ],
        },
      }),
    ).toBe(true);
    // Already-normalized entries are left alone.
    expect(
      proxyProviderApertureIdMigration.shouldRun({
        proxy: {
          upstreamProviders: [
            { id: "anthropic", apertureProviderId: "anthropic" },
          ],
        },
      }),
    ).toBe(false);
    // No upstream providers -> nothing to do.
    expect(proxyProviderApertureIdMigration.shouldRun({})).toBe(false);

    const migrated = proxyProviderApertureIdMigration.run({
      proxy: {
        upstreamProviders: [
          { id: "anthropic", shouldCheckGatewayModels: true },
          // An explicit manual mapping must be preserved as-is, not reset to id.
          { id: "openrouter", apertureProviderId: "anthropic" },
        ],
      },
    } as ApertureConfig);

    expect(migrated.proxy?.upstreamProviders).toEqual([
      {
        id: "anthropic",
        apertureProviderId: "anthropic",
        shouldCheckGatewayModels: true,
      },
      { id: "openrouter", apertureProviderId: "anthropic" },
    ]);
  });

  test("afterMerge normalizes proxied providers into the resolved shape", () => {
    // The loader's afterMerge hook (normalizeProxiedProviders) guarantees the
    // Required resolved shape at runtime even for hand-edited or
    // partially-written configs: missing apertureProviderId defaults to id,
    // missing shouldCheckGatewayModels to true.
    const base: ResolvedConfig = {
      baseUrl: "http://gateway.test",
      onboardingDone: true,
      onboarding: { enabled: false },
      proxy: {
        enabled: true,
        upstreamProviders: [
          // Missing apertureProviderId -> defaults to id.
          // Missing shouldCheckGatewayModels -> defaults to true.
          {
            id: "anthropic",
            apertureProviderId: undefined,
            shouldCheckGatewayModels: undefined,
          },
          // Explicit manual mapping preserved as-is.
          {
            id: "openrouter",
            apertureProviderId: "anthropic",
            shouldCheckGatewayModels: false,
          },
        ] as ResolvedConfig["proxy"]["upstreamProviders"],
      },
      dedicated: { enabled: false, providers: [] },
      connectors: { enabled: false, pinnedTools: [], discoveryTools: true },
    };

    const resolved = normalizeProxiedProviders(base);

    expect(resolved.proxy.upstreamProviders).toEqual([
      {
        id: "anthropic",
        apertureProviderId: "anthropic",
        shouldCheckGatewayModels: true,
      },
      {
        id: "openrouter",
        apertureProviderId: "anthropic",
        shouldCheckGatewayModels: false,
      },
    ]);
  });
});
