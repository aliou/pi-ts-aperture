import {
  arr,
  bool,
  int,
  map,
  obj,
  opt,
  type Static,
  str,
} from "@earendil-works/pi-schema";

export const ProviderCompatibilitySchema = obj(
  {
    openai_chat: opt(bool()),
    openai_responses: opt(bool()),
    anthropic_messages: opt(bool()),
    gemini_generate_content: opt(bool()),
    google_generate_content: opt(bool()),
    google_raw_predict: opt(bool()),
    bedrock_model_invoke: opt(bool()),
    bedrock_converse: opt(bool()),
    experimental_gemini_cli_vertex_compat: opt(bool()),
  },
  { open: true },
);

export type ProviderCompatibility = Static<typeof ProviderCompatibilitySchema>;

/**
 * Per-token USD pricing for a model, as reported by Aperture's `/v1/models`.
 *
 * All fields are per-token USD strings (e.g. `"0.00000100"`).
 * `web_search` and `input_cache_write_1h` have no direct mapping in Pi's
 * `ProviderModelConfig.cost` and are ignored when building model defaults.
 */
export const ApertureModelPricingSchema = obj(
  {
    input: opt(str()),
    input_cache_read: opt(str()),
    input_cache_write: opt(str()),
    input_cache_write_1h: opt(str()),
    output: opt(str()),
    web_search: opt(str()),
  },
  { open: true },
);

export type ApertureModelPricing = Static<typeof ApertureModelPricingSchema>;

export const ApertureModelInfoSchema = obj(
  {
    id: str(),
    pricing: opt(ApertureModelPricingSchema),
    /** Maximum input the model accepts, as advertised for this route. */
    context_window_tokens: opt(int({ minimum: 0 })),
    /** Maximum tokens the model can produce, as advertised for this route. */
    max_output_tokens: opt(int({ minimum: 0 })),
    /** The gateway serves this model over the System One classifier protocol. */
    system_one: opt(bool()),
  },
  { open: true },
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
export const ApertureModelEntrySchema = obj(
  {
    id: str(),
    metadata: obj(
      {
        provider: obj(
          {
            id: str(),
            name: opt(str()),
            description: opt(str()),
            requires_client_auth: opt(bool()),
          },
          { open: true },
        ),
      },
      { open: true },
    ),
    supported_endpoints: opt(arr(str())),
    pricing: opt(ApertureModelPricingSchema),
    context_window_tokens: opt(int({ minimum: 0 })),
    max_output_tokens: opt(int({ minimum: 0 })),
  },
  { open: true },
);

export type ApertureModelEntry = Static<typeof ApertureModelEntrySchema>;

export const ApertureProviderSchema = obj(
  {
    id: str(),
    name: str(),
    description: str(),
    models: arr(str()),
    compatibility: ProviderCompatibilitySchema,
    // Set by `auth_mode: "passthrough"` providers: the gateway forwards the
    // client's own credential, so the client must send a real one.
    requires_client_auth: opt(bool()),
    // Per-model info from `/v1/models` (pricing), keyed by model id.
    modelInfoById: map(ApertureModelInfoSchema),
  },
  { open: true },
);

export type ApertureProvider = Static<typeof ApertureProviderSchema>;

export const ConnectorInfoSchema = obj(
  {
    id: str(),
    description: opt(str()),
    protocol: opt(str()),
    provider: opt(str()),
    category: opt(str()),
    status: opt(str()),
    auth_type: opt(str()),
  },
  { open: true },
);

export type ConnectorInfo = Static<typeof ConnectorInfoSchema>;
