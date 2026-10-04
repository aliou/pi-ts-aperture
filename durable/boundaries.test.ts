import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const modules = /\b(?:from\s*|import\s*\(\s*|import\s*)(["'])([^"'\n]+)\1/g;

function importsIn(directory: string) {
  const base = resolve(root, directory);
  const files = readdirSync(base, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => !file.startsWith("dist/"));
  return files.flatMap((file) => {
    const path = resolve(base, file);
    return [...readFileSync(path, "utf8").matchAll(modules)].map((match) => ({
      path,
      specifier: match[2],
    }));
  });
}

test("src contains only Pi-agnostic gateway code", () => {
  for (const { path, specifier } of importsIn("src")) {
    expect(specifier, path).not.toMatch(
      /@(?:earendil-works|mariozechner)\/pi-|@aliou\/pi-/,
    );
    if (!specifier.startsWith(".")) continue;
    expect(resolve(dirname(path), specifier), path).toMatch(
      new RegExp(`^${resolve(root, "src")}/`),
    );
  }
});

test("durable owns its implementation without extension or src imports", () => {
  const base = resolve(root, "durable");
  for (const { path, specifier } of importsIn("durable")) {
    expect(specifier, path).not.toMatch(/pi-coding-agent|pi-tui|pi-utils-/);
    if (!specifier.startsWith(".")) continue;
    expect(resolve(dirname(path), specifier).startsWith(`${base}/`), path).toBe(
      true,
    );
  }
});

test("extensions do not depend on durable", () => {
  const base = resolve(root, "durable");
  for (const { path, specifier } of importsIn("extensions")) {
    expect(specifier, path).not.toMatch(
      /@aliou\/pi-ts-aperture\/(?:provider|proxy)/,
    );
    if (!specifier.startsWith(".")) continue;
    expect(resolve(dirname(path), specifier).startsWith(`${base}/`), path).toBe(
      false,
    );
  }
});
