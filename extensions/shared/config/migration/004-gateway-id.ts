import type { ApertureConfig, Migration } from "../types";

export const gatewayIdMigration: Migration<ApertureConfig> = {
  name: "004-gateway-id",
  version: "0.16.0",
  shouldRun: (config) =>
    config.proxy?.upstreamProviders?.some((p) => p.gatewayId === undefined) ??
    false,
  run: (config) => ({
    ...config,
    proxy: {
      ...config.proxy,
      upstreamProviders: config.proxy?.upstreamProviders?.map((p) => ({
        ...p,
        gatewayId: p.gatewayId ?? p.id,
      })),
    },
  }),
};
