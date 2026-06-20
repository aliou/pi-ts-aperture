import { parse as parseHujson, toJsonValue } from "@jaxxstorm/hujsonkit";
import type {
  ApertureProvider,
  ApertureProviderConfigInfo,
  ConnectorInfo,
} from "./types";

interface ProvidersResponse {
  providers?: unknown;
}

interface ConfigResponse {
  config?: unknown;
}

function parseProvider(
  value: unknown,
  fallbackId?: string,
): ApertureProvider | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : fallbackId;
  if (!id) return null;
  return {
    id,
    name: typeof record.name === "string" ? record.name : id,
    description:
      typeof record.description === "string" ? record.description : undefined,
    baseUrl:
      typeof record.baseUrl === "string"
        ? record.baseUrl
        : typeof record.base_url === "string"
          ? record.base_url
          : typeof record.baseurl === "string"
            ? record.baseurl
            : undefined,
    models: Array.isArray(record.models)
      ? record.models.filter(
          (model): model is string => typeof model === "string",
        )
      : [],
    compatibility:
      record.compatibility && typeof record.compatibility === "object"
        ? (record.compatibility as ApertureProvider["compatibility"])
        : {},
  };
}

export class ApertureClient {
  constructor(private readonly baseUrl: string) {}

  async providers(signal?: AbortSignal): Promise<ApertureProvider[]> {
    const res = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/api/providers`,
      {
        method: "GET",
        signal: signal ?? AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Aperture providers request failed: HTTP ${res.status} ${res.statusText}`,
      );
    }

    const body = (await res.json()) as ProvidersResponse | unknown[];
    if (Array.isArray(body)) {
      return body
        .map((provider) => parseProvider(provider))
        .filter((p): p is ApertureProvider => p !== null);
    }

    const providers = (body as ProvidersResponse).providers;
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
    const res = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/aperture/config`,
      {
        method: "GET",
        signal: signal ?? AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Aperture config request failed: HTTP ${res.status} ${res.statusText}`,
      );
    }

    const body = (await res.json()) as ConfigResponse;
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
        typeof record.baseurl === "string"
          ? record.baseurl
          : typeof record.baseUrl === "string"
            ? record.baseUrl
            : typeof record.base_url === "string"
              ? record.base_url
              : undefined;
      if (baseUrl) {
        result.set(id, {
          id,
          baseUrl,
          name: typeof record.name === "string" ? record.name : undefined,
        });
      }
    }
    return result;
  }

  async providerBaseUrls(signal?: AbortSignal): Promise<Map<string, string>> {
    const infos = await this.providerConfigInfos(signal);
    return new Map([...infos].map(([id, info]) => [id, info.baseUrl]));
  }

  async connectors(signal?: AbortSignal): Promise<ConnectorInfo[]> {
    const res = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/api/connectors`,
      {
        method: "GET",
        signal: signal ?? AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      throw new Error(
        `Aperture connectors request failed: HTTP ${res.status} ${res.statusText}`,
      );
    }

    const body = (await res.json()) as { connectors?: unknown[] };
    if (!Array.isArray(body.connectors)) return [];

    return body.connectors
      .map((c): ConnectorInfo | null => {
        if (!c || typeof c !== "object") return null;
        const record = c as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : undefined;
        if (!id) return null;
        return {
          id,
          description:
            typeof record.description === "string"
              ? record.description
              : undefined,
          protocol:
            typeof record.protocol === "string" ? record.protocol : undefined,
          provider:
            typeof record.provider === "string" ? record.provider : undefined,
          category:
            typeof record.category === "string" ? record.category : undefined,
          status: typeof record.status === "string" ? record.status : undefined,
          authType:
            typeof record.auth_type === "string" ? record.auth_type : undefined,
        };
      })
      .filter((c): c is ConnectorInfo => c !== null);
  }

  async health(signal?: AbortSignal): Promise<void> {
    await this.providers(signal);
  }
}
