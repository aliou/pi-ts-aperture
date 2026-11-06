import { compile } from "@earendil-works/pi-schema";
import {
  type ApertureModelEntry,
  ApertureModelEntrySchema,
  type ApertureProvider,
  type ConnectorInfo,
  ConnectorInfoSchema,
  type ProviderCompatibility,
} from "./types";

const modelEntryValidator = compile(ApertureModelEntrySchema);
const connectorValidator = compile(ConnectorInfoSchema);

function compatibilityFlag(
  endpoint: string,
): keyof ProviderCompatibility | null {
  switch (endpoint) {
    case "/v1/chat/completions":
      return "openai_chat";
    case "/v1/responses":
      return "openai_responses";
    case "/v1/messages":
      return "anthropic_messages";
    default:
      return endpoint.includes("generateContent")
        ? "gemini_generate_content"
        : null;
  }
}

/** Aperture's path for the System One classifier protocol. */
const SYSTEM_ONE_ENDPOINT = "/v1/systemone";

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
   * Provider catalog derived from `/v1/models`: entries are grouped by
   * `metadata.provider` and `supported_endpoints` are unioned into each
   * provider's compatibility map.
   */
  async providers(signal?: AbortSignal): Promise<ApertureProvider[]> {
    const body = await this._fetch<{ data?: unknown[] }>("/v1/models", {
      signal,
    });
    if (!Array.isArray(body.data)) return [];

    const providers = new Map<string, ApertureProvider>();
    for (const raw of body.data) {
      const entry: ApertureModelEntry | null = modelEntryValidator.check(raw)
        ? raw
        : null;
      if (!entry) continue;
      const metadata = entry.metadata.provider;
      const endpoints = entry.supported_endpoints ?? [];

      let provider = providers.get(metadata.id);
      if (!provider) {
        provider = {
          id: metadata.id,
          name: metadata.name || metadata.id,
          description: metadata.description ?? "",
          models: [],
          compatibility: {},
          requires_client_auth: metadata.requires_client_auth ?? false,
          modelInfoById: {},
        };
        providers.set(metadata.id, provider);
      }

      provider.models.push(entry.id);
      provider.modelInfoById[entry.id] = {
        id: entry.id,
        pricing: entry.pricing,
        context_window_tokens: entry.context_window_tokens,
        max_output_tokens: entry.max_output_tokens,
        system_one: endpoints.includes(SYSTEM_ONE_ENDPOINT),
      };
      for (const endpoint of endpoints) {
        const flag = compatibilityFlag(endpoint);
        if (flag) provider.compatibility[flag] = true;
      }
    }
    return [...providers.values()];
  }

  async connectors(signal?: AbortSignal): Promise<ConnectorInfo[]> {
    const body = await this._fetch<{ connectors?: unknown[] }>(
      "/api/connectors",
      {
        signal,
      },
    );
    if (!Array.isArray(body.connectors)) return [];

    return body.connectors.filter(connectorValidator.check);
  }

  async health(signal?: AbortSignal): Promise<void> {
    await this.providers(signal);
  }
}
