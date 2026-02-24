/**
 * Thin wrapper around the PI CLI for e2e tests.
 * Spawns `pi` with isolated config and parses tabular output.
 */

import { execSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ModelRow {
  provider: string;
  id: string;
  context: string;
  maxOut: string;
  thinking: string;
  images: string;
}

export class PiCli {
  private configDir: string;
  private piBin: string;
  private extensionPaths: string[];

  constructor(
    options: {
      piBin?: string;
      configDir?: string;
      extensionPaths?: string[];
    } = {},
  ) {
    this.configDir =
      options.configDir ??
      mkdtempSync(join(realpathSync(tmpdir()), "pi-test-"));
    this.piBin = options.piBin ?? "pi";
    this.extensionPaths = options.extensionPaths ?? [];

    writeFileSync(
      join(this.configDir, "settings.json"),
      JSON.stringify({ enabledModels: undefined }),
    );
  }

  run(args: string[], env?: Record<string, string>): string {
    const extensionArgs = this.extensionPaths.flatMap((p) => [
      "--extension",
      p,
    ]);
    const fullArgs = [
      "--config-dir",
      this.configDir,
      ...extensionArgs,
      "--no-extensions",
      ...args,
    ];

    const command = `${this.piBin} ${fullArgs.map((a) => `"${a}"`).join(" ")}`;

    try {
      return execSync(command, {
        env: { ...process.env, ...env, NODE_ENV: "test" },
        encoding: "utf-8",
        timeout: 30_000,
      });
    } catch (error: unknown) {
      if (error instanceof Error && "stdout" in error) {
        return (error as { stdout: string }).stdout;
      }
      throw error;
    }
  }

  listModels(): ModelRow[] {
    const output = this.run(["--list-models"]);
    return parseModelsTable(output);
  }
}

/**
 * Parse the tabular output from `pi --list-models`.
 * Columns are separated by 2+ spaces.
 */
function parseModelsTable(output: string): ModelRow[] {
  const lines = output.trim().split("\n");
  // Skip header line
  return lines.slice(1).reduce<ModelRow[]>((rows, line) => {
    if (!line.trim()) return rows;

    const parts = line.trim().split(/\s{2,}/);
    if (parts.length >= 6) {
      rows.push({
        provider: parts[0].trim(),
        id: parts[1].trim(),
        context: parts[2].trim(),
        maxOut: parts[3].trim(),
        thinking: parts[4].trim(),
        images: parts[5].trim(),
      });
    }
    return rows;
  }, []);
}

/**
 * Run a test callback with a PiCli instance.
 */
export async function withPiCli<T>(
  options: ConstructorParameters<typeof PiCli>[0],
  fn: (cli: PiCli) => Promise<T> | T,
): Promise<T> {
  const cli = new PiCli(options);
  return fn(cli);
}
