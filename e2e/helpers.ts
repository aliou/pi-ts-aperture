export const GATEWAY = "http://aperture-qa";

// One hardcoded model per enabled gateway provider.
export const DEDICATED_MODELS: Readonly<Record<string, string>> = {
  synthetic: "syn:small:text",
  neuralwatt: "glm-5.2-short-fast",
  mistral: "mistral-small-2603",
  zai: "glm-5.3-flash",
  gemini: "gemini-3.1-flash-lite",
  aperture: "openai/gpt-5.6-luna",
  openrouter: "anthropic/claude-sonnet-5",
};

// Proxy mode wraps local Pi providers by id; only these have one.
export const PROXY_MODELS: Readonly<Record<string, string>> = {
  synthetic: "syn:small:text",
  neuralwatt: "glm-5.2-short-fast",
};

export async function isAccessible(target: string): Promise<boolean> {
  try {
    const res = await fetch(`${target}/api/providers`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
