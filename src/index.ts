/**
 * Pi extension for Tailscale Aperture integration.
 *
 * Routes selected LLM providers through an Aperture gateway on your tailnet.
 * Aperture handles API key injection and request routing, so this extension
 * overrides each provider's baseUrl and sets a dummy apiKey.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerApertureSettings } from "./commands/settings";
import { registerSetupCommand } from "./commands/setup";
import { configLoader } from "./config";

function registerProviders(pi: ExtensionAPI): void {
  const config = configLoader.getConfig();
  if (!config.baseUrl || config.providers.length === 0) return;

  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  for (const provider of config.providers) {
    pi.registerProvider(provider, {
      baseUrl: `${baseUrl}/v1`,
      apiKey: "-",
    });
  }
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const onConfigChange = () => {
    // Config is already reloaded by configLoader.save(), just re-register.
    registerProviders(pi);
  };

  registerProviders(pi);
  registerSetupCommand(pi, onConfigChange);
  registerApertureSettings(pi, onConfigChange);
}
