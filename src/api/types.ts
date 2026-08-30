/**
 * Aperture API response types and their parsers.
 *
 * Parsing is hand-written rather than schema-driven on purpose: the extension
 * host may rewrite the bare `typebox` specifier onto its own bundled adapter
 * while leaving `typebox/value` pointing at the real package, so a schema
 * built here would not be a schema `Value.Check` understands. Plain functions
 * behave identically on every host.
 */

export interface ProviderCompatibility {
  openai_chat?: boolean;
  openai_responses?: boolean;
  anthropic_messages?: boolean;
  gemini_generate_content?: boolean;
  google_generate_content?: boolean;
  google_raw_predict?: boolean;
  bedrock_model_invoke?: boolean;
  bedrock_converse?: boolean;
  experimental_gemini_cli_vertex_compat?: boolean;
  // No index signature: the deleted `Static<>` types were closed too, and an
  // open one degenerates `keyof ProviderCompatibility` to `string`, silently
  // voiding the flag-name guard in `extensions/shared/api-selection.ts`.
  // Unknown keys still survive at runtime through the parser's spread.
}

const COMPATIBILITY_FLAGS = [
  "openai_chat",
  "openai_responses",
  "anthropic_messages",
  "gemini_generate_content",
  "google_generate_content",
  "google_raw_predict",
  "bedrock_model_invoke",
  "bedrock_converse",
  "experimental_gemini_cli_vertex_compat",
] as const;

/**
 * Per-token USD pricing for a model, as reported by Aperture's `/v1/models`.
 *
 * All fields are per-token USD strings (e.g. `"0.00000100"`).
 * `web_search` and `input_cache_write_1h` have no direct mapping in Pi's
 * `ProviderModelConfig.cost` and are ignored when building model defaults.
 */
export interface ApertureModelPricing {
  input?: string;
  input_cache_read?: string;
  input_cache_write?: string;
  input_cache_write_1h?: string;
  output?: string;
  web_search?: string;
}

/**
 * Model metadata retained from `/v1/models`. Used as a lookup so dedicated
 * mode can attach pricing to model configs without re-fetching the gateway.
 */
export interface ApertureModelInfo {
  id: string;
  pricing?: ApertureModelPricing;
}

export interface ApertureProvider {
  id: string;
  name: string;
  description: string;
  models: string[];
  compatibility: ProviderCompatibility;
  /** Set by `auth_mode: "passthrough"` providers: the gateway forwards the client's own credential. */
  requires_client_auth?: boolean;
  /** Populated from `/v1/models` by the client; never present on the raw `/api/providers` response. */
  modelInfoById?: Record<string, ApertureModelInfo>;
}

export interface ConnectorInfo {
  id: string;
  description: string;
  protocol: string;
  provider: string;
  category: string;
  status: string;
  auth_type?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** `""` when absent, the string when present, `null` (reject) when wrong-typed. */
function stringOrDefault(value: unknown): string | null {
  if (value === undefined) return "";
  return typeof value === "string" ? value : null;
}

/**
 * Parses one `/api/providers` entry.
 *
 * Absent `description` defaults to `""`, absent `models` to `[]`, absent
 * `compatibility` to `{}`; unknown keys are preserved. A declared field with
 * the wrong type rejects the whole entry rather than being coerced.
 */
export function parseApertureProvider(
  value: unknown,
  fallbackId?: string,
): ApertureProvider | null {
  const record = asRecord(value);
  if (!record) return null;

  // A map-keyed response supplies the id as the key, and the replaced
  // preprocessing overwrote whatever `record.id` held with it before
  // validating. Keep that: `providers: { openai: { id: null } }` is a real
  // shape under server-version skew, and rejecting it drops the provider
  // from discovery silently. Without a key there is nothing to fall back to.
  const id = typeof record.id === "string" ? record.id : fallbackId;
  if (!id) return null;

  // `null` counts as absent here, matching the replaced `name: record.name ?? id`
  // preprocessing: an unset optional string is `null` on the wire for most
  // server languages, and rejecting the whole provider over it would drop it
  // from the catalog silently.
  const rawName = record.name ?? id;
  if (typeof rawName !== "string") return null;
  const name = rawName;

  const description = stringOrDefault(record.description);
  if (description === null) return null;

  let models: string[];
  if (record.models === undefined) {
    models = [];
  } else if (
    Array.isArray(record.models) &&
    record.models.every((m) => typeof m === "string")
  ) {
    models = record.models as string[];
  } else {
    return null;
  }

  let compatibility: ProviderCompatibility;
  if (record.compatibility === undefined) {
    compatibility = {};
  } else {
    const compat = asRecord(record.compatibility);
    if (!compat) return null;
    for (const flag of COMPATIBILITY_FLAGS) {
      const value = compat[flag];
      if (value !== undefined && typeof value !== "boolean") return null;
    }
    compatibility = compat as ProviderCompatibility;
  }

  if (
    record.requires_client_auth !== undefined &&
    typeof record.requires_client_auth !== "boolean"
  ) {
    return null;
  }

  // `modelInfoById` is populated by the client after parsing and is never on
  // the wire. Dropping any inbound copy keeps a server-version skew from
  // slipping unvalidated pricing into dedicated model construction, where a
  // non-string rate would be coerced into a wildly wrong cost.
  const { modelInfoById: _ignored, ...rest } = record;
  return { ...rest, id, name, description, models, compatibility };
}

/**
 * Parses one `/api/connectors` entry. Absent string fields default to `""`;
 * a wrong-typed declared field rejects the entry.
 */
export function parseConnectorInfo(value: unknown): ConnectorInfo | null {
  const record = asRecord(value);
  if (!record) return null;
  if (typeof record.id !== "string") return null;
  if (record.auth_type !== undefined && typeof record.auth_type !== "string") {
    return null;
  }

  const description = stringOrDefault(record.description);
  const protocol = stringOrDefault(record.protocol);
  const provider = stringOrDefault(record.provider);
  const category = stringOrDefault(record.category);
  const status = stringOrDefault(record.status);
  if (
    description === null ||
    protocol === null ||
    provider === null ||
    category === null ||
    status === null
  ) {
    return null;
  }

  return {
    ...record,
    id: record.id,
    description,
    protocol,
    provider,
    category,
    status,
  };
}
