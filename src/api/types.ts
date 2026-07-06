import { type Static, Type } from "typebox";

export const ProviderCompatibilitySchema = Type.Object(
  {
    openai_chat: Type.Optional(Type.Boolean()),
    openai_responses: Type.Optional(Type.Boolean()),
    anthropic_messages: Type.Optional(Type.Boolean()),
    gemini_generate_content: Type.Optional(Type.Boolean()),
    google_generate_content: Type.Optional(Type.Boolean()),
    google_raw_predict: Type.Optional(Type.Boolean()),
    bedrock_model_invoke: Type.Optional(Type.Boolean()),
    bedrock_converse: Type.Optional(Type.Boolean()),
    experimental_gemini_cli_vertex_compat: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: true, default: {} },
);

export type ProviderCompatibility = Static<typeof ProviderCompatibilitySchema>;

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

export const ApertureModelInfoSchema = Type.Object(
  {
    id: Type.String(),
    pricing: Type.Optional(
      Type.Object(
        {
          input: Type.Optional(Type.String()),
          input_cache_read: Type.Optional(Type.String()),
          input_cache_write: Type.Optional(Type.String()),
          input_cache_write_1h: Type.Optional(Type.String()),
          output: Type.Optional(Type.String()),
          web_search: Type.Optional(Type.String()),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);

export const ApertureProviderSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.String({ default: "" }),
    models: Type.Array(Type.String(), { default: [] }),
    compatibility: ProviderCompatibilitySchema,
    // Populated from `/v1/models` so dedicated mode can attach pricing to
    // model configs. Not present on the raw `/api/providers` response.
    modelInfoById: Type.Optional(
      Type.Record(Type.String(), ApertureModelInfoSchema),
    ),
  },
  { additionalProperties: true },
);

export type ApertureProvider = Static<typeof ApertureProviderSchema>;

export const ConnectorInfoSchema = Type.Object(
  {
    id: Type.String(),
    description: Type.String({ default: "" }),
    protocol: Type.String({ default: "" }),
    provider: Type.String({ default: "" }),
    category: Type.String({ default: "" }),
    status: Type.String({ default: "" }),
    auth_type: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export type ConnectorInfo = Static<typeof ConnectorInfoSchema>;
