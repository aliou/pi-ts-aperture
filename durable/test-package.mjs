import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const app = mkdtempSync(join(tmpdir(), "aperture-package-"));
const env = { ...process.env, NODE_OPTIONS: "" };

try {
  const [packed] = JSON.parse(execFileSync("npm", [
    "pack", "--ignore-scripts", "--pack-destination", app, "--json",
  ], { cwd: root, env, encoding: "utf8" }));
  for (const entry of ["provider", "proxy"]) {
    for (const suffix of ["js", "d.ts"]) {
      assert(packed.files.some((file) => file.path === `durable/dist/${entry}.${suffix}`));
    }
  }
  for (const path of ["extensions/aperture/index.ts", "extensions/connectors/index.ts"]) {
    assert(packed.files.some((file) => file.path === path));
  }
  assert(packed.files.some((file) => file.path === "durable/README.md"));
  assert(!packed.files.some((file) => file.path.startsWith("extensions/fixtures/")));
  writeFileSync(join(app, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", [
    "install", "--ignore-scripts", "--no-audit", "--no-fund",
    join(app, packed.filename), "@earendil-works/pi-ai@1.0.0",
    "@earendil-works/pi-durable@1.0.0", "@earendil-works/chord@1.0.0",
  ], { cwd: app, env, stdio: "inherit" });

  for (const [file, source] of Object.entries({
    "library-smoke.mjs": "durable/fixtures/library-smoke.mjs",
    "types.mts": "durable/fixtures/types.mts",
    "pi-smoke.mjs": "extensions/fixtures/pi-smoke.mjs",
  })) {
    copyFileSync(join(root, source), join(app, file));
  }
  execFileSync(process.execPath, ["library-smoke.mjs"], { cwd: app, env, stdio: "inherit" });
  execFileSync(process.execPath, [join(root, "node_modules/typescript/bin/tsc"),
    "--noEmit", "--strict", "--skipLibCheck", "--target", "ES2022",
    "--module", "NodeNext", "--moduleResolution", "NodeNext", "types.mts",
  ], { cwd: app, env, stdio: "inherit" });
  console.log("Packaged NodeNext declarations passed");
  execFileSync(process.execPath, ["pi-smoke.mjs"], {
    cwd: app,
    env: { ...env, PI_CODING_AGENT_DIR: join(app, "agent"), APERTURE_BASE_URL: "http://ai.pango-lin.ts.net",
      APERTURE_TEST_PI_HOST: pathToFileURL(join(root, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")).href },
    stdio: "inherit",
  });
} finally {
  rmSync(app, { recursive: true, force: true });
}
