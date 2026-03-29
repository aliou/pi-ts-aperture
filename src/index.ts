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
import { planConfigChange, resolveProviderBaseUrl } from "./core";
import {
  applyAperture,
  checkGatewayModels,
  refreshActiveModel,
} from "./providers/aperture";

function notifyMissingModelsOnce(
  ctx: ExtensionContext,
  missingModels: string[],
  warnedModels: Set<string>,
): void {
  const newMissing = missingModels.filter((id) => !warnedModels.has(id));
  if (newMissing.length > 0) {
    for (const id of newMissing) warnedModels.add(id);
    ctx.ui.notify(
      `[aperture] models not available on gateway: ${newMissing.join(", ")}. Add them to the gateway configuration.`,
      "warning",
    );
  }
}

function registerApertureLifecycleHook(
  pi: ExtensionAPI,
  warnedModels: Set<string>,
): void {
  pi.on("before_agent_start", async (_event, ctx) => {
    if (!ctx?.modelRegistry) return;

    const { providers: overriddenProviders, gatewayUrl } = await applyAperture(
      pi,
      ctx.modelRegistry,
    );

    if (
      ctx.model &&
      overriddenProviders.includes(ctx.model.provider) &&
      gatewayUrl !== null &&
      configLoader.getConfig().checkGatewayModels.includes(ctx.model.provider)
    ) {
      const { missingModels } = await checkGatewayModels(
        gatewayUrl,
        ctx.modelRegistry,
      );
      notifyMissingModelsOnce(ctx, missingModels, warnedModels);
    }

    if (!ctx.model || !overriddenProviders.includes(ctx.model.provider)) return;

    await refreshActiveModel(pi, ctx);
  });

  // Also check when user switches to a model whose provider uses aperture
  pi.on("model_select", async (_event, ctx) => {
    if (!ctx?.model) return;

    const config = configLoader.getConfig();
    if (!config.providers.includes(ctx.model.provider)) return;

    const gatewayUrl = resolveProviderBaseUrl(config)?.replace("/v1", "");
    if (!gatewayUrl) return;

    if (config.checkGatewayModels.includes(ctx.model.provider)) {
      const { missingModels } = await checkGatewayModels(
        gatewayUrl,
        ctx.modelRegistry,
      );
      notifyMissingModelsOnce(ctx, missingModels, warnedModels);
    }
  });
}

function createConfigChangeHandler(
  pi: ExtensionAPI,
  warnedModels: Set<string>,
): (ctx: ExtensionContext) => void {
  let lastRegisteredProviders = [...configLoader.getConfig().providers];

  return (ctx: ExtensionContext) => {
    const { providers } = configLoader.getConfig();

    const plan = planConfigChange(
      lastRegisteredProviders,
      providers,
      ctx.model?.provider,
    );

    void applyAperture(pi, ctx.modelRegistry).then(
      async ({ providers, gatewayUrl }) => {
        if (
          ctx.model &&
          providers.includes(ctx.model.provider) &&
          gatewayUrl !== null &&
          configLoader
            .getConfig()
            .checkGatewayModels.includes(ctx.model.provider)
        ) {
          const { missingModels } = await checkGatewayModels(
            gatewayUrl,
            ctx.modelRegistry,
          );
          notifyMissingModelsOnce(ctx, missingModels, warnedModels);
        }
      },
    );
    lastRegisteredProviders = [...providers];

    if (plan.shouldRefreshModel) {
      void refreshActiveModel(pi, ctx).then((updated) => {
        if (!updated) return;
        ctx.ui.notify(
          `[aperture] re-routing ${ctx.model?.id ?? "model"} through ${ctx.model?.baseUrl ?? "aperture"}`,
          "info",
        );
      });
    }

    for (const provider of plan.removedProviders) {
      pi.unregisterProvider(provider);
    }
  };
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const warnedModels = new Set<string>();

  registerApertureLifecycleHook(pi, warnedModels);

  const onConfigChange = createConfigChangeHandler(pi, warnedModels);
  registerSetupCommand(pi, onConfigChange);
  registerApertureSettings(pi, onConfigChange);
}
