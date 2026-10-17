import type { Api, Model } from "@earendil-works/pi-ai";

/** Resolved metadata overrides for one gateway model. */
export interface ModelMetadata {
  name?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Model<Api>["thinkingLevelMap"];
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
  /** Only set from provider-exact matches; per-million-token USD rates. */
  cost?: Model<Api>["cost"];
  /** Only set from a provider-exact Pi registry match. */
  compat?: Model<Api>["compat"];
}
