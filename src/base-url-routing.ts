/**
 * Shared base-URL routing logic for proxy and dedicated modes.
 *
 * Pi-agnostic: decides whether a model should be registered against the
 * Aperture gateway root or `gateway/v1`, based on the Pi API and the upstream
 * provider's base URL.
 *
 * Both modes share the same rule because Aperture's URL construction is the
 * same in both: it appends the incoming request path to the provider's
 * `baseurl`. A standard client sends `/v1/chat/completions`, which works for
 * providers whose upstream is a root (Mistral, DeepSeek) or ends in `/v1`
 * (OpenAI, Groq, OpenRouter). It breaks only for providers whose `baseurl`
 * already includes a non-`/v1` version segment (e.g. Z.ai
 * `/api/coding/paas/v4`), because `/v1` doubles on top (`/v4/v1/...`). Those
 * providers need the gateway root so the client sends a versionless path.
 */

import type { Api } from "@earendil-works/pi-ai";

const ROOT_BASE_URL_APIS = new Set<Api>([
  // Pi's Anthropic adapter uses Anthropic's SDK, which appends /v1/messages
  // itself. Registering /v1 would produce /v1/v1/messages, which Aperture
  // does not expose.
  "anthropic-messages",
  // Pi's Codex adapter appends /codex/responses itself. Registering /v1
  // would produce /v1/codex/responses, which Aperture does not expose.
  "openai-codex-responses",
]);

// Pi passes `model.baseUrl` straight to the OpenAI SDK for these APIs, which
// then appends /chat/completions or /responses.
const OPENAI_SDK_APIS = new Set<Api>([
  "openai-completions",
  "openai-responses",
]);

/**
 * `true` when `baseUrl`'s pathname ends in a version segment that is NOT `/v1`
 * (e.g. `/v4`, `/v4beta`, `/v2rc1`). Such providers need a versionless client
 * path because Aperture would otherwise double the version (`/v4/v1/...`).
 * Returns `false` for `/v1`, root baseurls, and missing/unparseable URLs.
 */
function hasNonV1VersionPath(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const path = new URL(baseUrl).pathname.replace(/\/+$/u, "");
    const match = path.match(/\/(v\d+\w*)$/u);
    return match !== null && match[1] !== "v1";
  } catch {
    return false;
  }
}

/**
 * Whether a model should register against the Aperture gateway root instead of
 * `gateway/v1`.
 *
 * - Anthropic and Codex always use the root (their SDKs/adapter append the full
 *   API path themselves).
 * - OpenAI SDK APIs (`openai-completions`, `openai-responses`) use the root
 *   only when the upstream base URL ends in a non-`/v1` version segment
 *   (e.g. Z.ai `/api/coding/paas/v4`).
 * - Other APIs keep the conservative `gateway/v1` behavior.
 * - Missing or unparseable upstream URLs keep `gateway/v1` to stay safe.
 */
export function shouldUseGatewayRoot(
  api: Api,
  upstreamBaseUrl?: string,
): boolean {
  if (ROOT_BASE_URL_APIS.has(api)) return true;
  if (!OPENAI_SDK_APIS.has(api)) return false;
  return hasNonV1VersionPath(upstreamBaseUrl);
}
