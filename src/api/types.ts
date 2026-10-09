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
export const ApertureModelPricingSchema = Type.Object(
  {
    input: Type.Optional(Type.String()),
    input_cache_read: Type.Optional(Type.String()),
    input_cache_write: Type.Optional(Type.String()),
    input_cache_write_1h: Type.Optional(Type.String()),
    output: Type.Optional(Type.String()),
    web_search: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

export type ApertureModelPricing = Static<typeof ApertureModelPricingSchema>;

export const ApertureModelInfoSchema = Type.Object(
  {
    id: Type.String(),
    pricing: Type.Optional(ApertureModelPricingSchema),
    /** Maximum input the model accepts, as advertised for this route. */
    context_window_tokens: Type.Optional(Type.Integer({ minimum: 0 })),
    /** Maximum tokens the model can produce, as advertised for this route. */
    max_output_tokens: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: true },
);

export type ApertureModelInfo = Static<typeof ApertureModelInfoSchema>;

/**
 * Token limits a gateway entry advertises for a model. They describe the
 * route the request takes, not the model, so they outrank catalog metadata.
 * Non-positive values mean "not reported" (the gateway clamps zeroed limits
 * to absent).
 */
export type ApertureModelLimits = Pick<
  ApertureModelInfo,
  "context_window_tokens" | "max_output_tokens"
>;

/** A `/v1/models` entry. */
export const ApertureModelEntrySchema = Type.Object(
  {
    id: Type.String(),
    metadata: Type.Object(
      {
        provider: Type.Object(
          {
            id: Type.String(),
            name: Type.Optional(Type.String()),
            description: Type.String({ default: "" }),
            requires_client_auth: Type.Boolean({ default: false }),
          },
          { additionalProperties: true },
        ),
      },
      { additionalProperties: true },
    ),
    supported_endpoints: Type.Array(Type.String(), { default: [] }),
    pricing: Type.Optional(ApertureModelPricingSchema),
    context_window_tokens: Type.Optional(Type.Integer({ minimum: 0 })),
    max_output_tokens: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  { additionalProperties: true },
);

export type ApertureModelEntry = Static<typeof ApertureModelEntrySchema>;

export const ApertureProviderSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.String({ default: "" }),
    models: Type.Array(Type.String(), { default: [] }),
    compatibility: ProviderCompatibilitySchema,
    // Set by `auth_mode: "passthrough"` providers: the gateway forwards the
    // client's own credential, so the client must send a real one.
    requires_client_auth: Type.Optional(Type.Boolean()),
    // Per-model info from `/v1/models` (pricing), keyed by model id.
    modelInfoById: Type.Record(Type.String(), ApertureModelInfoSchema),
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
