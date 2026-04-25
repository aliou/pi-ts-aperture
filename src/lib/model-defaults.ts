import type { ProviderModelConfig } from "@mariozechner/pi-coding-agent";

export function buildDefaultModelConfig(id: string): ProviderModelConfig {
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}
