/**
 * Gateway health and model checking.
 */

export interface HealthCheckResult {
  ok: boolean;
  error?: string;
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

export interface GatewayModel {
  id: string;
  providerId: string;
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
    const body = (await res.json()) as {
      data?: {
        id: string;
        metadata?: { provider?: { id?: string } };
      }[];
    };
    return (
      body.data
        ?.map((m) => ({
          id: m.id,
          providerId: m.metadata?.provider?.id ?? "",
        }))
        .filter((m) => m.providerId.length > 0) ?? []
    );
  } catch {
    return [];
  }
}
