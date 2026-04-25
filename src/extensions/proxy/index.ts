/**
 * Aperture provider extension.
 *
 * Routes selected Pi providers through Tailscale Aperture.
 * Registers the setup wizard and settings commands.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../../lib/config";
import { resolveGatewayUrl } from "../../lib/url";
import { ApertureRuntime } from "./runtime";
import { registerApertureSettings } from "./settings-command";
import { registerSetupCommand } from "./setup-command";

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const runtime = new ApertureRuntime();
  let lastRegisteredProviders: string[] = [
    ...configLoader.getConfig().providers,
  ];

  // Sync function used by commands after config changes
  const onSync = (ctx: ExtensionContext): void => {
    const config = configLoader.getConfig();

    // Unregister providers that were removed from config
    const prevProviders = lastRegisteredProviders;
    const nextProviders = config.providers;
    const toRemove = runtime.getProvidersToUnregister(
      prevProviders,
      nextProviders,
    );
    for (const provider of toRemove) {
      pi.unregisterProvider(provider);
      ctx.ui.notify(
        `[aperture] unregistered ${provider}. Run /reload to use the native provider.`,
        "info",
      );
    }

    // Re-register providers
    void runtime
      .sync({
        registerProvider: pi.registerProvider.bind(pi),
        getModels: () => ctx.modelRegistry.getAll(),
      })
      .then(() => {
        // Refresh active model if it's from a registered provider
        if (
          ctx.model &&
          ctx.modelRegistry.find(ctx.model.provider, ctx.model.id)
        ) {
          const updated = ctx.modelRegistry.find(
            ctx.model.provider,
            ctx.model.id,
          );
          if (updated && config.providers.includes(ctx.model.provider)) {
            void pi.setModel(updated);
          }
        }
      });

    // Check for missing models on gateway if configured
    if (config.checkGatewayModels.length > 0) {
      const gatewayUrl = resolveGatewayUrl(config);
      if (gatewayUrl) {
        void runtime.checkMissingModels(
          {
            getModels: () => ctx.modelRegistry.getAll(),
            notify: (msg, type) => ctx.ui.notify(msg, type),
          },
          gatewayUrl,
        );
      }
    }

    lastRegisteredProviders = [...nextProviders];
  };

  // Register providers at session start (for new sessions)
  pi.on("session_start", (_event, ctx) => {
    lastRegisteredProviders = [...configLoader.getConfig().providers];
    void runtime.sync({
      registerProvider: pi.registerProvider.bind(pi),
      getModels: () => ctx.modelRegistry.getAll(),
    });
  });

  registerSetupCommand(pi, onSync);
  registerApertureSettings(pi, onSync);
}
