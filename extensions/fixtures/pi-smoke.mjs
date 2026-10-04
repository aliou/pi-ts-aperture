import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const agentDir = process.env.PI_CODING_AGENT_DIR;
mkdirSync(join(agentDir, "extensions"), { recursive: true });
writeFileSync(join(agentDir, "extensions/aperture.json"), JSON.stringify({
  baseUrl: "http://ai.pango-lin.ts.net", onboardingDone: true, onboarding: { enabled: false },
  dedicated: { enabled: true, providers: [] }, proxy: { enabled: false, upstreamProviders: [] }, connectors: { enabled: true },
}));
globalThis.fetch = () => { throw new Error("Pi package loading must not fetch"); };
const { DefaultResourceLoader, SettingsManager } = await import(process.env.APERTURE_TEST_PI_HOST);
const packageRoot = join(process.cwd(), "node_modules/@aliou/pi-ts-aperture");
const loader = new DefaultResourceLoader({ cwd: process.cwd(), agentDir,
  settingsManager: SettingsManager.inMemory({ packages: [packageRoot] }),
  noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
assert.equal(loaded.extensions.length, 2);
for (const path of ["aperture/index.ts", "connectors/index.ts"]) {
  assert(loaded.extensions.some((extension) => extension.path.endsWith(path)), path);
}
assert(loaded.extensions.some((extension) => extension.commands.has("aperture:settings")));
assert(loaded.runtime.pendingNativeProviderRegistrations.some((entry) => entry.provider.id === "aperture"));
assert.deepEqual(loaded.runtime.mcpServers.get("aperture")?.config, {
  url: "http://ai.pango-lin.ts.net/v1/mcp", exposure: "deferred",
});
assert.deepEqual(loaded.warnings ?? [], []);
console.log("Packed Pi package discovery and both extension factories passed");
