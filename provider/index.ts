import type { Api, Provider, ProviderStreams } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { bedrockConverseStreamApi } from "@earendil-works/pi-ai/api/bedrock-converse-stream.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { googleVertexApi } from "@earendil-works/pi-ai/api/google-vertex.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import type { ApiUpstreams } from "../src/api-routing";
import { refreshDedicatedCatalog } from "../src/provider/catalog";
import { createDedicatedProvider } from "../src/provider/dedicated";
import { normalizeInputUrl, resolveGatewayUrl } from "../src/url";
import type { ProvenanceOptions } from "./headers";
import { provenanceRequestHeaders, withProvenanceHeaders } from "./headers";

export { DEDICATED_PROVIDER_ID } from "../src/provider/dedicated";
export {
  DEFAULT_ATTRIBUTION_URL,
  type ProvenanceOptions,
  provenanceRequestHeaders,
  SESSION_ID_HEADER,
  withProvenanceHeaders,
} from "./headers";

export interface ApertureProviderOptions {
  /** Aperture gateway URL, e.g. `https://ai.<tailnet>.ts.net`. */
  baseUrl: string;
  /** Referer and session-id provenance headers. On by default. */
  provenance?: ProvenanceOptions;
}

const lazyUpstreams: ApiUpstreams = (api: Api): ProviderStreams | undefined => {
  switch (api) {
    case "openai-completions":
      return openAICompletionsApi();
    case "openai-responses":
      return openAIResponsesApi();
    case "anthropic-messages":
      return anthropicMessagesApi();
    case "google-generative-ai":
      return googleGenerativeAIApi();
    case "google-vertex":
      return googleVertexApi();
    case "bedrock-converse-stream":
      return bedrockConverseStreamApi();
    default:
      return undefined;
  }
};

/**
 * Build the standalone `aperture` provider: a pi-ai Provider whose catalog is
 * fetched from the gateway's `/v1` surface. The host drives refreshes through
 * pi-ai's `Models.refresh()` (or a direct `provider.refreshModels(context)`).
 * Streams dispatch through pi-ai's lazy API implementations, so the bundle
 * loads no API modules until a request needs one.
 */
export default function createApertureProvider(
  options: ApertureProviderOptions,
): Provider {
  const gatewayUrl = resolveGatewayUrl({
    baseUrl: normalizeInputUrl(options.baseUrl),
  });
  if (!gatewayUrl) {
    throw new Error("Aperture provider requires a gateway baseUrl");
  }
  const baseUrl = `${gatewayUrl}/v1`;
  const provenanceHeaders = provenanceRequestHeaders(options.provenance);
  const upstreams: ApiUpstreams = (api) => {
    const upstream = lazyUpstreams(api);
    if (!upstream) return undefined;
    return withProvenanceHeaders(upstream, provenanceHeaders);
  };

  return createDedicatedProvider(
    baseUrl,
    (context) =>
      refreshDedicatedCatalog(context, {
        gatewayUrl,
        baseUrl,
        providers: [],
        getRegistryModels: () => [],
      }),
    upstreams,
    provenanceHeaders,
  );
}
