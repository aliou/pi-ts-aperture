/**
 * Pi extension for Tailscale Aperture integration.
 *
 * Routes selected LLM providers through an Aperture gateway on your tailnet.
 * Aperture handles API key injection and request routing, so this extension
 * overrides each provider's baseUrl and sets a dummy apiKey.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { VERSION } from "@mariozechner/pi-coding-agent";
import { registerApertureSettings } from "./commands/settings";
import { registerSetupCommand } from "./commands/setup";
import { configLoader } from "./config";

/**
 * Compute the full Aperture base URL from config, or null if not configured.
 */
function resolveBaseUrl(): string | null {
  const { baseUrl, providers } = configLoader.getConfig();
  if (!baseUrl || providers.length === 0) return null;
  return `${baseUrl.replace(/\/+$/, "")}/v1`;
}

/**
 * Override provider registrations to route through Aperture.
 * Preserves existing models so extensions that registered custom models
 * before this runs don't lose them.
 */
function overrideProviders(
  pi: ExtensionAPI,
  registry: ExtensionContext["modelRegistry"],
  providers: string[],
  baseUrl: string,
): void {
  for (const provider of providers) {
    const models = registry.getAll().filter((m) => m.provider === provider);

    pi.registerProvider(provider, {
      baseUrl,
      apiKey: "-",
      ...(models.length > 0 && { api: models[0].api, models }),
    });
  }
}

/**
 * Apply Aperture configuration to the model registry.
 * Returns the list of providers that were overridden, or empty if no-op.
 */
function applyAperture(
  pi: ExtensionAPI,
  registry: ExtensionContext["modelRegistry"],
): string[] {
  const url = resolveBaseUrl();
  if (!url) return [];

  const { providers } = configLoader.getConfig();
  overrideProviders(pi, registry, providers, url);
  return providers;
}

export default async function (pi: ExtensionAPI): Promise<void> {
  console.log(`[pi-ts-aperture] loaded on pi ${VERSION}`);
  await configLoader.load();

  let lastRegisteredProviders = [...configLoader.getConfig().providers];

  // Apply after all extensions have registered their providers and models.
  pi.events.on("before_agent_start", async (data) => {
    const ctx = data as ExtensionContext;
    if (!ctx?.modelRegistry) return;
    applyAperture(pi, ctx.modelRegistry);
  });

  const onSetupComplete = (ctx: ExtensionContext) => {
    const { providers } = configLoader.getConfig();
    const removed = lastRegisteredProviders.filter(
      (p) => !providers.includes(p),
    );

    applyAperture(pi, ctx.modelRegistry);
    lastRegisteredProviders = [...providers];

    // Re-resolve active model if it belongs to a reconfigured provider.
    if (ctx.model && providers.includes(ctx.model.provider)) {
      const updated = ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
      if (updated) {
        ctx.ui.notify(
          `[aperture] re-routing ${ctx.model.id} through ${updated.baseUrl}`,
          "info",
        );
        pi.setModel(updated);
      }
    }

    for (const p of removed) {
      pi.unregisterProvider(p);
    }
  };

  registerSetupCommand(pi, onSetupComplete);
  registerApertureSettings(pi, onSetupComplete);
}
