/**
 * Shared Aperture endpoint-to-Pi-API mapping.
 *
 * Aperture's `/v1/models` returns `supported_endpoints` per model (e.g.
 * `["/v1/chat/completions", "/v1/messages", "/v1/responses"]`). This module
 * maps those endpoint paths to Pi `Api` values, mirroring the provider-level
 * `compatibility`-to-`Api` mapping in dedicated mode but driven by per-model
 * data.
 *
 * Lives in `src/` alongside `base-url-routing.ts` because it is a pure
 * mapping from Aperture concepts to Pi concepts, with no dependency on Pi's
 * runtime — it can be reused by any mode that needs to resolve a Pi API from
 * gateway-reported endpoints.
 */

import type { Api } from "@earendil-works/pi-ai";

const ENDPOINT_TO_API: Record<string, Api> = {
  "/v1/chat/completions": "openai-completions",
  "/v1/messages": "anthropic-messages",
  "/v1/responses": "openai-responses",
};

/** Preference order matches `getApiForCompatibility`: chat completions first. */
const ENDPOINT_PREFERENCE: Api[] = [
  "openai-completions",
  "anthropic-messages",
  "openai-responses",
];

/**
 * Map a `/v1/models` `supported_endpoints` list to a Pi API.
 *
 * Returns `null` when the list is absent, empty, or contains no recognized
 * endpoint, so the caller can fall back to the provider-level `compatibility`
 * map for older gateways that don't report `supported_endpoints`.
 *
 * Preference order matches `getApiForCompatibility`: chat completions first
 * (Aperture's default and broadest tool-calling path), then Anthropic
 * messages, then OpenAI responses. Gemini, Vertex, and Bedrock endpoints are
 * not exposed via `supported_endpoints` on current gateways; those providers
 * continue to route through `getApiForCompatibility`.
 */
export function getApiForEndpoints(
  supportedEndpoints: string[] | undefined,
): Api | null {
  if (!supportedEndpoints || supportedEndpoints.length === 0) return null;
  const available = new Set(
    supportedEndpoints
      .map((ep) => ENDPOINT_TO_API[ep])
      .filter((api): api is Api => api !== undefined),
  );
  if (available.size === 0) return null;
  for (const api of ENDPOINT_PREFERENCE) {
    if (available.has(api)) return api;
  }
  // Fallback: first recognized endpoint (shouldn't happen with current data).
  return available.values().next().value ?? null;
}
