/**
 * Pi extension for Tailscale Aperture integration.
 *
 * Keeps the entry point focused on orchestration:
 * - load config
 * - register lifecycle hooks
 * - register user commands
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { registerApertureSettings } from "./commands/settings";
import { registerSetupCommand } from "./commands/setup";
import { configLoader } from "./config";
import { applyAperture, refreshActiveModel } from "./providers/aperture";

function registerApertureLifecycleHook(pi: ExtensionAPI): void {
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!ctx?.modelRegistry) return;

    const overriddenProviders = await applyAperture(pi, ctx.modelRegistry);
    if (!ctx.model || !overriddenProviders.includes(ctx.model.provider)) return;

    await refreshActiveModel(pi, ctx);
  });
}

function createConfigChangeHandler(
  pi: ExtensionAPI,
): (ctx: ExtensionContext) => void {
  let lastRegisteredProviders = [...configLoader.getConfig().providers];

  return (ctx: ExtensionContext) => {
    const { providers } = configLoader.getConfig();
    const removedProviders = lastRegisteredProviders.filter(
      (provider) => !providers.includes(provider),
    );

    void applyAperture(pi, ctx.modelRegistry);
    lastRegisteredProviders = [...providers];

    if (ctx.model && providers.includes(ctx.model.provider)) {
      void refreshActiveModel(pi, ctx).then((updated) => {
        if (!updated) return;
        ctx.ui.notify(
          `[aperture] re-routing ${ctx.model?.id ?? "model"} through ${ctx.model?.baseUrl ?? "aperture"}`,
          "info",
        );
      });
    }

    for (const provider of removedProviders) {
      pi.unregisterProvider(provider);
    }
  };
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  registerApertureLifecycleHook(pi);

  const onConfigChange = createConfigChangeHandler(pi);
  registerSetupCommand(pi, onConfigChange);
  registerApertureSettings(pi, onConfigChange);
}
