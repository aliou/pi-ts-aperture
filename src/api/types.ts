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
}

export interface ApertureProviderConfigInfo {
  id: string;
  name?: string;
  baseUrl: string;
}

export interface ApertureProvider {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  models: string[];
  compatibility: ProviderCompatibility;
}
