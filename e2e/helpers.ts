// CI uses the MagicDNS short name; locally, override with the FQDN:
//   APERTURE_E2E_GATEWAY=http://aperture-qa.tetra-albacore.ts.net \
//     pnpm exec vitest run --config vitest.e2e.config.ts
export const GATEWAY = process.env.APERTURE_E2E_GATEWAY ?? "http://aperture-qa";

// One hardcoded model per enabled gateway provider.
export const DEDICATED_MODELS: Readonly<Record<string, string>> = {
  synthetic: "syn:small:text",
  neuralwatt: "kimi-k3",
  gemini: "gemini-3.1-flash-lite",
  aperture: "openai/gpt-5.6-luna",
  openrouter: "anthropic/claude-sonnet-5",
};

// Proxy mode wraps local Pi providers by id; only these have one.
export const PROXY_MODELS: Readonly<Record<string, string>> = {
  synthetic: "syn:small:text",
  neuralwatt: "kimi-k3",
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
