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

export const ApertureProviderSchema = Type.Object(
  {
    id: Type.String(),
    name: Type.String(),
    description: Type.String({ default: "" }),
    models: Type.Array(Type.String(), { default: [] }),
    compatibility: ProviderCompatibilitySchema,
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
