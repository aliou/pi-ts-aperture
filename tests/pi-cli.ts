/**
 * RPC Client for Pi e2e tests.
 * Uses RpcClient from pi-coding-agent to spawn pi in RPC mode
 * and provides typed access to models.
 */

import { resolve } from "node:path";
import { type ModelInfo, RpcClient } from "@mariozechner/pi-coding-agent/modes";

export type { ModelInfo };

/**
 * Absolute path to the pi CLI entry point (local node_modules install).
 * RpcClient spawns `node <cliPath>`, so we provide the resolved absolute path.
 */
const PI_CLI_PATH = resolve(
  "node_modules/@mariozechner/pi-coding-agent/dist/cli.js",
);

export class PiCli {
  private rpc: RpcClient;

  constructor(
    private options: {
      extensionPaths?: string[];
      env?: Record<string, string>;
    } = {},
  ) {
    const extraArgs: string[] = ["--no-extensions"];
    for (const ext of this.options.extensionPaths ?? []) {
      extraArgs.push("--extension", ext);
    }

    this.rpc = new RpcClient({
      cliPath: PI_CLI_PATH,
      env: this.options.env,
      args: extraArgs,
    });
  }

  async start(): Promise<void> {
    await this.rpc.start();
  }

  async stop(): Promise<void> {
    await this.rpc.stop();
  }

  async listModels(): Promise<ModelInfo[]> {
    return this.rpc.getAvailableModels();
  }
}

export async function withPiCli<T>(
  options: ConstructorParameters<typeof PiCli>[0],
  fn: (cli: PiCli) => Promise<T>,
): Promise<T> {
  const cli = new PiCli(options);
  await cli.start();
  try {
    return await fn(cli);
  } finally {
    await cli.stop();
  }
}
