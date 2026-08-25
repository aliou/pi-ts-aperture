import type { Api } from "@earendil-works/pi-ai";
import type { ProviderCompatibility } from "../../src/api/types";

// Chat completions first: Aperture's default and the broadest mode for Pi's
// tool-calling path. Flags with no Pi dispatch are not mappable.
const COMPATIBILITY_TO_API = [
  ["openai_chat", "openai-completions"],
  ["anthropic_messages", "anthropic-messages"],
  ["openai_responses", "openai-responses"],
  ["gemini_generate_content", "google-generative-ai"],
  ["google_generate_content", "google-vertex"],
  ["bedrock_converse", "bedrock-converse-stream"],
] as const satisfies readonly (readonly [keyof ProviderCompatibility, Api])[];

/** Pi APIs a gateway provider can serve, in auto-pick precedence order. */
export function getSelectableApis(
  compatibility: ProviderCompatibility | undefined,
): Api[] {
  if (!compatibility) return [];
  return COMPATIBILITY_TO_API.filter(([flag]) => compatibility[flag]).map(
    ([, api]) => api,
  );
}

/** Auto-picked API: first selectable in precedence order. */
export function getApiForCompatibility(
  compatibility: ProviderCompatibility | undefined,
): Api {
  return getSelectableApis(compatibility)[0] ?? "openai-completions";
}

/** Validates per-provider api overrides against a compatibility map. */
export function isSelectableApi(
  api: Api,
  compatibility: ProviderCompatibility | undefined,
): boolean {
  return getSelectableApis(compatibility).includes(api);
}
