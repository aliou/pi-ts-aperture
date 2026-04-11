/**
 * Pure URL helpers.
 */

import type { ApertureConfig } from "./types";

/**
 * Normalizes a user-input URL:
 * - Trims whitespace
 * - Adds http:// scheme if missing
 * - Strips trailing /v1 or /v1/
 * - Strips trailing slashes
 */
export function normalizeInputUrl(raw: string): string {
  let result = raw.trim();
  if (!result) return result;
  if (!result.startsWith("http://") && !result.startsWith("https://")) {
    result = `http://${result}`;
  }
  return result.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

/**
 * Returns configured gateway URL without trailing slash, or null when
 * baseUrl is empty. Mode-agnostic: the caller decides whether the current
 * mode has anything to do with the URL.
 */
export function resolveGatewayUrl(config: ApertureConfig): string | null {
  const { baseUrl } = config;
  if (!baseUrl) return null;
  return baseUrl.replace(/\/+$/, "");
}

/**
 * Returns the Aperture provider base URL used for provider registration.
 * Appends /v1 to the gateway URL.
 * Returns null when gateway URL cannot be resolved.
 */
export function resolveProviderBaseUrl(config: ApertureConfig): string | null {
  const gateway = resolveGatewayUrl(config);
  if (!gateway) return null;
  return `${gateway}/v1`;
}
