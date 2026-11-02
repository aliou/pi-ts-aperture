import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["provider/index.ts"],
  outDir: "dist/provider",
  format: "esm",
  dts: true,
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
