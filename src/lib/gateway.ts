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
