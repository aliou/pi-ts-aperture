import type { ProviderHeaders, ProviderStreams } from "@earendil-works/pi-ai";

export const DEFAULT_ATTRIBUTION_URL = "https://pi.dev";
export const SESSION_ID_HEADER = "x-session-id";

export interface ProvenanceOptions {
  enabled?: boolean;
  referer?: string;
}

export function provenanceRequestHeaders(
  options: ProvenanceOptions | undefined,
): ProviderHeaders | undefined {
  if (options?.enabled === false) return undefined;
  return { Referer: options?.referer ?? DEFAULT_ATTRIBUTION_URL };
}

export function withProvenanceHeaders(
  streams: ProviderStreams,
  headers: ProviderHeaders | undefined,
): ProviderStreams {
  if (!headers) return streams;

  const withHeaders =
    <O extends { headers?: ProviderHeaders; sessionId?: string }>(
      fn: (model: never, mid: never, options?: O) => unknown,
    ) =>
    (model: never, mid: never, options?: O): unknown => {
      const provenance: ProviderHeaders = options?.sessionId
        ? { ...headers, [SESSION_ID_HEADER]: options.sessionId }
        : headers;
      return fn(model, mid, {
        ...options,
        headers: { ...provenance, ...options?.headers },
      } as O);
    };

  const next: ProviderStreams = {
    stream: withHeaders(streams.stream) as typeof streams.stream,
    streamSimple: withHeaders(
      streams.streamSimple,
    ) as typeof streams.streamSimple,
  };
  if (streams.fetchDeferred) {
    next.fetchDeferred = withHeaders(streams.fetchDeferred) as NonNullable<
      typeof streams.fetchDeferred
    >;
  }
  if (streams.cancelDeferred) {
    next.cancelDeferred = withHeaders(streams.cancelDeferred) as NonNullable<
      typeof streams.cancelDeferred
    >;
  }
  return next;
}
