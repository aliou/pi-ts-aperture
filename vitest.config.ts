import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mariozechner/pi-coding-agent/modes": resolve(
        "node_modules/@mariozechner/pi-coding-agent/dist/modes/index.js",
      ),
    },
  },
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    mockReset: true,
  },
});
