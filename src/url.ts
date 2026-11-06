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
    // Unparseable input: return it unchanged; toGatewayUrl strips the path.
    return result;
  }
}

/**
 * Gateway root from user input: normalized, /v1 suffix and trailing
 * slashes stripped. Returns null for empty input.
 */
export function toGatewayUrl(raw: string): string | null {
  const normalized = normalizeInputUrl(raw);
  if (!normalized) return null;
  return normalized.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
}

/**
 * Aperture provider base URL for a resolved gateway root: the gateway URL
 * with /v1 appended.
 */
export function providerBaseUrl(gatewayUrl: string): string {
  return `${gatewayUrl}/v1`;
}

/**
 * Returns configured gateway URL without trailing slash.
 * Returns null when baseUrl is empty.
 */
export function resolveGatewayUrl(config: UrlConfig): string | null {
  return config.baseUrl ? toGatewayUrl(config.baseUrl) : null;
}

/**
 * Returns the Aperture provider base URL used for provider registration.
 * Appends /v1 to the gateway URL.
 * Returns null when gateway URL cannot be resolved.
 */
export function resolveProviderBaseUrl(config: UrlConfig): string | null {
  const gateway = resolveGatewayUrl(config);
  return gateway ? providerBaseUrl(gateway) : null;
}
