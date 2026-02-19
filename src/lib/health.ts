/**
 * Health check for the Aperture gateway.
 *
 * Hits GET <baseUrl>/v1/models to verify the gateway is reachable.
 * Uses native fetch (no extra dependencies).
 */

export interface HealthCheckResult {
  ok: boolean;
  error?: string;
}

export async function checkApertureHealth(baseUrl: string): Promise<HealthCheckResult> {
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
