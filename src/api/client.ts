import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  type ApertureProvider,
  ApertureProviderSchema,
  type ConnectorInfo,
  ConnectorInfoSchema,
} from "./types";

function validate<T>(schema: TSchema, value: unknown): T | null {
  const withDefaults = Value.Default(schema, value);
  return Value.Check(schema, withDefaults) ? (withDefaults as T) : null;
}

function parseProvider(
  value: unknown,
  fallbackId?: string,
): ApertureProvider | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : fallbackId;
  if (!id) return null;

  return validate<ApertureProvider>(ApertureProviderSchema, {
    ...record,
    id,
    name: record.name ?? id,
  });
}

function parseProvidersBody(body: unknown): ApertureProvider[] {
  if (Array.isArray(body)) {
    return body
      .map((provider) => parseProvider(provider))
      .filter((p): p is ApertureProvider => p !== null);
  }
  if (!body || typeof body !== "object") return [];

  const providers = (body as { providers?: unknown }).providers;
  if (Array.isArray(providers)) {
    return providers
      .map((provider) => parseProvider(provider))
      .filter((p): p is ApertureProvider => p !== null);
  }
  if (providers && typeof providers === "object") {
    return Object.entries(providers as Record<string, unknown>).flatMap(
      ([id, provider]) => {
        const parsed = parseProvider(provider, id);
        return parsed ? [parsed] : [];
      },
    );
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
   * Set of model ids exposed by `/v1/models`.
   *
   * Disabled providers' models do not appear in `/v1/models`, so this is the
   * source of truth for which gateway providers are usable. Failures (network,
   * 404, ...) resolve to an empty set, which leaves the `/api/providers`
   * result unfiltered as a safe fallback.
   */
  private async enabledModelIds(signal?: AbortSignal): Promise<Set<string>> {
    try {
      const body = await this._fetch<{ data?: unknown[] }>("/v1/models", {
        signal,
      });
      if (!Array.isArray(body.data)) return new Set();
      const ids = new Set<string>();
      for (const entry of body.data) {
        if (!entry || typeof entry !== "object") continue;
        const id = (entry as Record<string, unknown>).id;
        if (typeof id === "string") ids.add(id);
      }
      return ids;
    } catch {
      return new Set();
    }
  }

  async providers(signal?: AbortSignal): Promise<ApertureProvider[]> {
    const [body, enabledModelIds] = await Promise.all([
      this._fetch<{ providers?: unknown } | unknown[]>("/api/providers", {
        signal,
      }),
      this.enabledModelIds(signal),
    ]);

    const parsed = parseProvidersBody(body);
    if (enabledModelIds.size === 0) return parsed;

    return parsed
      .map((provider) => ({
        ...provider,
        models: provider.models.filter((id) => enabledModelIds.has(id)),
      }))
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
      .map((c): ConnectorInfo | null => {
        if (!c || typeof c !== "object") return null;
        return validate<ConnectorInfo>(ConnectorInfoSchema, c);
      })
      .filter((c): c is ConnectorInfo => c !== null);
  }

  async health(signal?: AbortSignal): Promise<void> {
    await this.providers(signal);
  }
}
