import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";

let cached: boolean | undefined;

/**
 * Whether pi's telemetry gate permits provenance header injection.
 *
 * Read-only mirror of pi's own gate (`isInstallTelemetryEnabled`):
 * `PI_TELEMETRY` wins (only `1`/`true`/`yes` count as on), else
 * `enableInstallTelemetry` from project then global settings, defaulting to
 * enabled. Users who opted out of pi telemetry don't get provenance headers
 * either.
 *
 * The decision is memoized for the life of the module: the hook runs on
 * every provider request and must not re-read settings files per call.
 */
export function isProvenanceTelemetryAllowed(): boolean {
  if (cached === undefined) cached = compute();
  return cached;
}

function compute(): boolean {
  const env = process.env.PI_TELEMETRY;
  if (env !== undefined) {
    return (
      env === "1" || env.toLowerCase() === "true" || env.toLowerCase() === "yes"
    );
  }
  for (const path of [
    join(process.cwd(), CONFIG_DIR_NAME, "settings.json"),
    join(getAgentDir(), "settings.json"),
  ]) {
    const value = readEnableInstallTelemetry(path);
    if (value !== undefined) return value;
  }
  return true;
}

/** Read `enableInstallTelemetry` from a pi settings file, if decodable. */
function readEnableInstallTelemetry(path: string): boolean | undefined {
  try {
    const value = (
      JSON.parse(readFileSync(path, "utf-8")) as {
        enableInstallTelemetry?: unknown;
      }
    )?.enableInstallTelemetry;
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** For tests; the memoization is not meant to be invalidated at runtime. */
export function resetProvenanceTelemetryCache(): void {
  cached = undefined;
}
