/**
 * Pure URL helpers.
 */

interface UrlConfig {
  baseUrl?: string;
}

/**
 * Normalizes a user-input URL:
 * - Trims whitespace
 * - Adds http:// scheme if missing
 * - Parses with URL constructor and extracts origin (scheme + host + port)
 * - This handles full URLs like "http://ai.host.ts.net/v1/models" -> "http://ai.host.ts.net"
 * - Also handles bare hosts like "ai.host.ts.net" -> "http://ai.host.ts.net"
 */
export function normalizeInputUrl(raw: string): string {
  let result = raw.trim();
  if (!result) return result;
  if (!result.startsWith("http://") && !result.startsWith("https://")) {
    result = `http://${result}`;
  }
  try {
    const parsed = new URL(result);
    // Return just the origin (scheme + host + port), discarding path/query/fragment
    return parsed.origin;
  } catch {
    // Fallback for unparseable input: strip /v1 and trailing slashes
    return result.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  }
}

/**
 * Returns configured gateway URL without trailing slash.
 * Returns null when baseUrl is empty.
 */
export function resolveGatewayUrl(config: UrlConfig): string | null {
  const { baseUrl } = config;
  if (!baseUrl) return null;
  return baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

/**
 * Returns the Aperture provider base URL used for provider registration.
 * Appends /v1 to the gateway URL.
 * Returns null when gateway URL cannot be resolved.
 */
export function resolveProviderBaseUrl(config: UrlConfig): string | null {
  const gateway = resolveGatewayUrl(config);
  if (!gateway) return null;
  return `${gateway}/v1`;
}
