/**
 * Gateway health and model checking.
 */

export interface HealthCheckResult {
  ok: boolean;
  error?: string;
}

export interface GatewayModel {
  id: string;
  providerId: string;
  provider?: {
    id: string;
    name?: string;
  };
  pricing?: {
    input?: string;
    input_cache_read?: string;
    input_cache_write?: string;
    output?: string;
  };
}

export interface GatewayProviderCompatibility {
  openai_chat?: boolean;
  openai_responses?: boolean;
  anthropic_messages?: boolean;
  gemini_generate_content?: boolean;
  google_generate_content?: boolean;
  google_raw_predict?: boolean;
  bedrock_model_invoke?: boolean;
  bedrock_converse?: boolean;
  experimental_gemini_cli_vertex_compat?: boolean;
}

interface GatewayConfigResponse {
  config?: string;
}

interface GatewayConfig {
  providers?: Record<
    string,
    {
      compatibility?: GatewayProviderCompatibility;
    }
  >;
}

interface GatewayModelResponse {
  data?: {
    id: string;
    metadata?: {
      provider?: {
        id?: string;
        name?: string;
      };
    };
    pricing?: {
      input?: string;
      input_cache_read?: string;
      input_cache_write?: string;
      output?: string;
    };
  }[];
}

export async function checkApertureHealth(
  baseUrl: string,
): Promise<HealthCheckResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
    }
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function fetchGatewayModels(
  baseUrl: string,
): Promise<GatewayModel[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as GatewayModelResponse;
    return (
      body.data
        ?.map((m) => {
          const providerId = m.metadata?.provider?.id ?? "";
          return {
            id: m.id,
            providerId,
            provider: providerId
              ? {
                  id: providerId,
                  name: m.metadata?.provider?.name,
                }
              : undefined,
            pricing: m.pricing
              ? {
                  input: m.pricing.input,
                  input_cache_read: m.pricing.input_cache_read,
                  input_cache_write: m.pricing.input_cache_write,
                  output: m.pricing.output,
                }
              : undefined,
          };
        })
        .filter((m) => m.providerId.length > 0) ?? []
    );
  } catch {
    return [];
  }
}

export async function fetchGatewayModelIds(baseUrl: string): Promise<string[]> {
  const models = await fetchGatewayModels(baseUrl);
  return models.map((m) => m.id);
}

export async function fetchGatewayProviderCompatibility(
  baseUrl: string,
): Promise<Map<string, GatewayProviderCompatibility>> {
  const url = `${baseUrl.replace(/\/+$/, "")}/aperture/config`;
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const body = (await res.json()) as GatewayConfigResponse;
    if (!body.config) return new Map();

    const config = JSON.parse(body.config) as GatewayConfig;
    const result = new Map<string, GatewayProviderCompatibility>();
    for (const [id, provider] of Object.entries(config.providers ?? {})) {
      if (provider.compatibility) result.set(id, provider.compatibility);
    }
    return result;
  } catch {
    return new Map();
  }
}

export interface GatewayProvider {
  id: string;
  name?: string;
}

/** Extract unique providers from gateway models. */
export async function fetchGatewayProviders(
  baseUrl: string,
): Promise<GatewayProvider[]> {
  const models = await fetchGatewayModels(baseUrl);
  const seen = new Map<string, GatewayProvider>();
  for (const model of models) {
    if (model.provider && !seen.has(model.provider.id)) {
      seen.set(model.provider.id, {
        id: model.provider.id,
        name: model.provider.name,
      });
    }
  }
  return [...seen.values()];
}
