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
      throw new Error(
        `[Aperture] ${method} ${path}: -> ${res.status} ${res.statusText}`,
      );
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
    const body = await this._fetch<{ config?: unknown }>("/aperture/config", {
      signal,
    });
    const configStr = typeof body.config === "string" ? body.config : undefined;
    if (!configStr) return new Map();

    let rawConfig: unknown;
    try {
      rawConfig = toJsonValue(parseHujson(configStr));
    } catch {
      return new Map();
    }

    const providers = (rawConfig as Record<string, unknown>).providers;
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
