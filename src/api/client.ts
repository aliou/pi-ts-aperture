import {
  type ApertureModelInfo,
  type ApertureProvider,
  type ConnectorInfo,
  parseApertureProvider,
  parseConnectorInfo,
} from "./types";

function parseProvidersBody(body: unknown): ApertureProvider[] {
  if (Array.isArray(body)) {
    return body
      .map((provider) => parseApertureProvider(provider))
      .filter((p): p is ApertureProvider => p !== null);
  }
  if (!body || typeof body !== "object") return [];

  const providers = "providers" in body ? body.providers : undefined;
  if (Array.isArray(providers)) {
    return providers
      .map((provider) => parseApertureProvider(provider))
      .filter((p): p is ApertureProvider => p !== null);
  }
  if (providers && typeof providers === "object") {
    return Object.entries(providers).flatMap(([id, provider]) => {
      const parsed = parseApertureProvider(provider, id);
      return parsed ? [parsed] : [];
    });
  }
  return [];
}

/**
 * HTTP error raised by {@link ApertureClient._fetch} on non-OK responses.
 */
export class ApertureHttpError extends Error {
  readonly status: number;

  constructor(
    method: string,
    path: string,
    status: number,
    statusText: string,
  ) {
    super(`[Aperture] ${method} ${path}: -> ${status} ${statusText}`);
    this.name = "ApertureHttpError";
    this.status = status;
  }
}

export class ApertureClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async _fetch<T = unknown>(
    path: string,
    {
      method = "GET",
      signal,
    }: {
      method?: string;
      signal?: AbortSignal;
    },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const timeoutSignal = AbortSignal.timeout(5000);
    const composedSignal = signal
      ? AbortSignal.any([signal, timeoutSignal])
      : timeoutSignal;

    const res = await fetch(url, { method, signal: composedSignal });
    if (!res.ok) {
      throw new ApertureHttpError(method, path, res.status, res.statusText);
    }
    return res.json() as T;
  }

  /**
   * Models exposed by `/v1/models`, keyed by id.
   *
   * Disabled providers' models do not appear in `/v1/models`, so this is the
   * source of truth for which gateway providers are usable. The full entry
   * (including `pricing`) is retained so dedicated mode can attach costs to
   * model configs without re-fetching the gateway. Failures (network, 404, ...)
   * resolve to an empty map, which leaves the `/api/providers` result
   * unfiltered as a safe fallback.
   */
  private async enabledModelsById(
    signal?: AbortSignal,
  ): Promise<Map<string, ApertureModelInfo>> {
    try {
      const body = await this._fetch<{ data?: unknown[] }>("/v1/models", {
        signal,
      });
      if (!Array.isArray(body.data)) return new Map();
      const byId = new Map<string, ApertureModelInfo>();
      for (const entry of body.data) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const id = record.id;
        if (typeof id !== "string") continue;
        byId.set(id, {
          id,
          pricing: record.pricing as ApertureModelInfo["pricing"] | undefined,
        });
      }
      return byId;
    } catch {
      return new Map();
    }
  }

  async providers(signal?: AbortSignal): Promise<ApertureProvider[]> {
    const [body, enabledModelsById] = await Promise.all([
      this._fetch<{ providers?: unknown } | unknown[]>("/api/providers", {
        signal,
      }),
      this.enabledModelsById(signal),
    ]);

    const parsed = parseProvidersBody(body);
    if (enabledModelsById.size === 0) return parsed;

    return parsed
      .map((provider) => {
        const models = provider.models.filter((id) =>
          enabledModelsById.has(id),
        );
        const modelInfoById: Record<string, ApertureModelInfo> = {};
        for (const id of models) {
          const info = enabledModelsById.get(id);
          if (info) modelInfoById[id] = info;
        }
        return { ...provider, models, modelInfoById };
      })
      .filter((provider) => provider.models.length > 0);
  }

  async connectors(signal?: AbortSignal): Promise<ConnectorInfo[]> {
    const body = await this._fetch<{ connectors?: unknown[] }>(
      "/api/connectors",
      {
        signal,
      },
    );
    if (!Array.isArray(body.connectors)) return [];

    return body.connectors
      .map((c) => parseConnectorInfo(c))
      .filter((c): c is ConnectorInfo => c !== null);
  }

  async health(signal?: AbortSignal): Promise<void> {
    await this.providers(signal);
  }
}
