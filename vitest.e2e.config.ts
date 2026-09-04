import { defineConfig } from "vitest/config";

/**
 * E2E test config. Separate from the unit config so `pnpm test` stays
 * hermetic: only the files under e2e/ run here, against a live Aperture
 * gateway (see e2e/helpers.ts for target resolution and skipping).
 *
 * Run with: pnpm exec vitest run --config vitest.e2e.config.ts
 */
export default defineConfig({
  test: {
    include: ["e2e/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    mockReset: true,
  },
});
