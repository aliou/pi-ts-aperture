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
import { registerApertureSettings } from "./commands/settings";
import { registerSetupCommand } from "./commands/setup";
import { configLoader } from "./config";

function getApertureBaseUrl(): string | null {
  const config = configLoader.getConfig();
  if (!config.baseUrl || config.providers.length === 0) return null;
  return `${config.baseUrl.replace(/\/+$/, "")}/v1`;
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const config = configLoader.getConfig();
  let lastRegisteredProviders = [...config.providers];

  // At load time, pi.registerProvider() queue is flushed by the runner.
  const baseUrl = getApertureBaseUrl();
  if (baseUrl) {
    for (const provider of config.providers) {
      pi.registerProvider(provider, { baseUrl, apiKey: "-" });
    }
  }

  const onSetupComplete = (ctx: ExtensionContext) => {
    const cfg = configLoader.getConfig();
    const removedProviders = lastRegisteredProviders.filter(
      (p) => !cfg.providers.includes(p),
    );

    const url = getApertureBaseUrl();
    if (url) {
      for (const provider of cfg.providers) {
        ctx.modelRegistry.registerProvider(provider, {
          baseUrl: url,
          apiKey: "-",
        });
      }
    }
    lastRegisteredProviders = [...cfg.providers];

    // The active model is a snapshot. If it belongs to a provider we just
    // reconfigured, re-resolve it so the new baseUrl takes effect.
    if (ctx.model && cfg.providers.includes(ctx.model.provider)) {
      const updated = ctx.modelRegistry.find(ctx.model.provider, ctx.model.id);
      if (updated) {
        ctx.ui.notify(
          `[aperture] re-routing ${ctx.model.id} through ${updated.baseUrl}`,
          "info",
        );
        pi.setModel(updated);
      }
    }

    if (removedProviders.length > 0) {
      ctx.ui.notify(
        `Removed providers (${removedProviders.join(", ")}) will revert after /reload`,
        "warning",
      );
    }
  };

  registerSetupCommand(pi, onSetupComplete);
  registerApertureSettings(pi, onSetupComplete);
}
