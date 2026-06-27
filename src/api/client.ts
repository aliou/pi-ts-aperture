import { parse as parseHujson, toJsonValue } from "@jaxxstorm/hujsonkit";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  type ApertureProvider,
  type ApertureProviderConfigInfo,
  ApertureProviderConfigInfoSchema,
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

/**
 * HTTP error raised by {@link ApertureClient._fetch}. Carries the status
 * code so callers can tolerate specific responses — for example the 403 that
 * the admin-only `/aperture/config` endpoint returns to non-admin grants.
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

  async providers(signal?: AbortSignal): Promise<ApertureProvider[]> {
    const body = await this._fetch<{ providers?: unknown } | unknown[]>(
      "/api/providers",
      {
        signal,
      },
    );
    if (Array.isArray(body)) {
      return body
        .map((provider) => parseProvider(provider))
        .filter((p): p is ApertureProvider => p !== null);
    }

    const providers = body.providers;
    if (Array.isArray(providers)) {
      return providers
        .map((provider) => parseProvider(provider))
        .filter((p): p is ApertureProvider => p !== null);
    }
    if (providers && typeof providers === "object") {
      return Object.entries(providers).flatMap(([id, provider]) => {
        const parsed = parseProvider(provider, id);
        return parsed ? [parsed] : [];
      });
    }

    return [];
  }

  async providerConfigInfos(
    signal?: AbortSignal,
  ): Promise<Map<string, ApertureProviderConfigInfo>> {
    // `/aperture/config` is admin-only on the Aperture gateway (requires
    // role:admin). Non-admin grants get HTTP 403 and have no access to the
    // upstream provider base URLs. We tolerate that and return an empty
    // map so the rest of the client keeps working: proxy provider matching
    // falls back to IDs via `/api/providers`, which non-admin grants can
    // access (and dedicated mode never reads this endpoint). Any other
    // failure still propagates.
    let body: { config?: unknown };
    try {
      body = await this._fetch<{ config?: unknown }>("/aperture/config", {
        signal,
      });
    } catch (error) {
      if (error instanceof ApertureHttpError && error.status === 403) {
        return new Map();
      }
      throw error;
    }
    let config = body.config;
    if (typeof config === "string") {
      try {
        config = toJsonValue(parseHujson(config));
      } catch {
        return new Map();
      }
    }
    if (!config || typeof config !== "object") return new Map();

    const providers = (config as { providers?: unknown }).providers;
    if (!providers || typeof providers !== "object") return new Map();

    const result = new Map<string, ApertureProviderConfigInfo>();
    for (const [id, provider] of Object.entries(providers)) {
      if (!provider || typeof provider !== "object") continue;
      const record = provider as Record<string, unknown>;
      const baseUrl =
        (typeof record.baseurl === "string" ? record.baseurl : undefined) ??
        (typeof record.baseUrl === "string" ? record.baseUrl : undefined) ??
        (typeof record.base_url === "string" ? record.base_url : undefined);
      if (!baseUrl) continue;

      const parsed = validate<ApertureProviderConfigInfo>(
        ApertureProviderConfigInfoSchema,
        { ...record, id, baseUrl },
      );
      if (parsed) result.set(id, parsed);
    }
    return result;
  }

  async providerBaseUrls(signal?: AbortSignal): Promise<Map<string, string>> {
    const infos = await this.providerConfigInfos(signal);
    return new Map([...infos].map(([id, info]) => [id, info.baseUrl]));
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
