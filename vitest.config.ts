import { resolve } from "node:path";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";

config({ path: ".env.test", quiet: true });

export default defineConfig({
  resolve: {
    alias: {
      "@earendil-works/pi-coding-agent/modes": resolve(
        "node_modules/@earendil-works/pi-coding-agent/dist/modes/index.js",
      ),
    },
  },
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.ts", "extensions/**/*.test.ts"],
    mockReset: true,
  },
});
