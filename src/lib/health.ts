/**
 * Health check + model discovery for the Aperture gateway.
 *
 * Hits GET <baseUrl>/v1/models to verify the gateway is reachable and to
 * enumerate the models it exposes. Uses native fetch (no extra dependencies).
 *
 * Aperture's /v1/models response is OpenAI-shaped but Aperture-specific:
 * - `id`: model id, usually namespaced (e.g. "anthropic/claude-haiku-4.5")
 * - `owned_by`: "ts-llm-proxy"
 * - `metadata.provider.{id,name}`: the upstream provider inside Aperture
 * - `pricing.{input,output,input_cache_read,input_cache_write,...}`: per-token
 *    cost as decimal strings (e.g. "0.00000100" = $1.00 / 1M tokens).
 *
 * Only the fields the gateway actually emits are propagated into
 * `GatewayModelInfo`. Callers apply defaults where the gateway stays silent.
 */

import type { GatewayModelInfo } from "../core/types";

export interface HealthCheckResult {
  ok: boolean;
  error?: string;
}

const MODELS_TIMEOUT_MS = 5000;

function modelsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/v1/models`;
}

export async function checkApertureHealth(
  baseUrl: string,
): Promise<HealthCheckResult> {
  try {
    const res = await fetch(modelsUrl(baseUrl), {
      method: "GET",
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
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

/**
 * Fetch the full /v1/models response and return one `GatewayModelInfo` per
 * entry. Only fields present on the wire are propagated; callers apply
 * defaults where the gateway stays silent.
 */
export async function fetchGatewayModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<GatewayModelInfo[]> {
  try {
    const res = await fetch(modelsUrl(baseUrl), {
      method: "GET",
      signal: signal ?? AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: unknown };
    return parseGatewayModelsResponse(body);
  } catch {
    return [];
  }
}

/** Back-compat helper: return only the ids from the gateway response. */
export async function fetchGatewayModelIds(baseUrl: string): Promise<string[]> {
  const models = await fetchGatewayModels(baseUrl);
  return models.map((m) => m.id);
}

// ---------------------------------------------------------------------------
// Response parsing (exported for unit tests)
// ---------------------------------------------------------------------------

export function parseGatewayModelsResponse(body: unknown): GatewayModelInfo[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => parseGatewayModel(entry))
    .filter((m): m is GatewayModelInfo => m !== null);
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function asBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length === v.length ? out : undefined;
}

/**
 * Parse a pricing value that may arrive as either a number or a decimal
 * string, and convert it from per-token (Aperture's wire format) to
 * per-million-tokens (Pi's `Model.cost` convention).
 */
function parsePricingPerMillion(v: unknown): number | undefined {
  let n: number | undefined;
  if (typeof v === "number" && Number.isFinite(v)) {
    n = v;
  } else if (typeof v === "string") {
    const parsed = Number.parseFloat(v);
    if (Number.isFinite(parsed)) n = parsed;
  }
  if (n === undefined) return undefined;
  return n * 1_000_000;
}

/**
 * Map a single /v1/models entry into a GatewayModelInfo. Only fields present
 * on the wire are propagated. Returns null when the entry has no usable id.
 */
function parseGatewayModel(entry: unknown): GatewayModelInfo | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;

  const id = asString(e.id);
  if (!id) return null;

  const info: GatewayModelInfo = { id };

  // Display name: Aperture's wire format has no `name` field, but tolerate
  // one if a future version adds it.
  const name = asString(e.name) ?? asString(e.display_name);
  if (name !== undefined) info.name = name;

  // Context window (not currently emitted by Aperture; tolerated for forward
  // compatibility with multiple likely field spellings).
  const contextWindow =
    asNumber(e.contextWindow) ??
    asNumber(e.context_window) ??
    asNumber(e.context_length);
  if (contextWindow !== undefined) info.contextWindow = contextWindow;

  const maxTokens =
    asNumber(e.maxTokens) ??
    asNumber(e.max_tokens) ??
    asNumber(e.max_output_tokens);
  if (maxTokens !== undefined) info.maxTokens = maxTokens;

  const inputModalities =
    asStringArray(e.input) ?? asStringArray(e.input_modalities);
  if (inputModalities !== undefined) info.input = inputModalities;

  const reasoning = asBoolean(e.reasoning);
  if (reasoning !== undefined) info.reasoning = reasoning;

  const api = asString(e.api);
  if (api !== undefined) info.api = api;

  // Pricing: Aperture emits per-token decimal strings with keys like
  // `input`, `output`, `input_cache_read`, `input_cache_write`. Convert to
  // per-million to match Pi's cost convention, and drop wire-only keys
  // (image, web_search, internal_reasoning) that have no Pi slot.
  const rawPricing = e.pricing ?? e.cost;
  if (rawPricing && typeof rawPricing === "object") {
    const p = rawPricing as Record<string, unknown>;
    const cost: NonNullable<GatewayModelInfo["cost"]> = {};

    const input = parsePricingPerMillion(p.input);
    if (input !== undefined) cost.input = input;

    const output = parsePricingPerMillion(p.output);
    if (output !== undefined) cost.output = output;

    const cacheRead =
      parsePricingPerMillion(p.input_cache_read) ??
      parsePricingPerMillion(p.cacheRead) ??
      parsePricingPerMillion(p.cache_read);
    if (cacheRead !== undefined) cost.cacheRead = cacheRead;

    const cacheWrite =
      parsePricingPerMillion(p.input_cache_write) ??
      parsePricingPerMillion(p.cacheWrite) ??
      parsePricingPerMillion(p.cache_write);
    if (cacheWrite !== undefined) cost.cacheWrite = cacheWrite;

    if (Object.keys(cost).length > 0) info.cost = cost;
  }

  return info;
}
