/**
 * Aperture proxy extension.
 *
 * Routes selected Pi providers through Tailscale Aperture.
 * Only active when config.mode === "proxy".
 * Registers settings commands.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { configLoader } from "../../lib/config";
import { emitConfigSync } from "../../lib/sync-bus";
import { resolveGatewayUrl } from "../../lib/url";
import { ApertureRuntime } from "./runtime";
import { registerApertureSettings } from "./settings-command";

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const runtime = new ApertureRuntime();
  let lastRegisteredProviders: string[] = [
    ...configLoader.getConfig().proxy.upstreamProviders.map((p) => p.id),
  ];

  // Sync function used by commands after config changes
  const onSync = (ctx: ExtensionContext): void => {
    emitConfigSync();

    const config = configLoader.getConfig();

    // Only apply proxy changes when in proxy mode
    if (config.mode === "proxy") {
      // Unregister providers that were removed from config
      const prevProviders = lastRegisteredProviders;
      const nextProviders = config.proxy.upstreamProviders.map((p) => p.id);
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
          const active = ctx.model;
          if (active && ctx.modelRegistry.find(active.provider, active.id)) {
            const updated = ctx.modelRegistry.find(active.provider, active.id);
            if (
              updated &&
              config.proxy.upstreamProviders.some(
                (p) => p.id === active.provider,
              )
            ) {
              void pi.setModel(updated);
            }
          }
        });

      // Check for missing models on gateway if configured
      const checkedProviderIds = config.proxy.upstreamProviders
        .filter((p) => p.shouldCheckGatewayModels)
        .map((p) => p.id);
      if (checkedProviderIds.length > 0) {
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
    }
  };

  pi.on("session_start", (_event, ctx) => {
    const config = configLoader.getConfig();

    // Register providers at session start when in proxy mode
    if (config.mode === "proxy") {
      lastRegisteredProviders = [
        ...config.proxy.upstreamProviders.map((p) => p.id),
      ];
      void runtime.sync({
        registerProvider: pi.registerProvider.bind(pi),
        getModels: () => ctx.modelRegistry.getAll(),
      });
    }
  });

  // Always register settings command
  registerApertureSettings(pi, onSync);
}
