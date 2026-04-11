/**
 * Pi extension for Tailscale Aperture integration.
 *
 * Keeps the entry point focused on orchestration:
 * - load config
 * - register lifecycle hooks
 * - register user commands
 *
 * Two modes are supported and are mutually exclusive:
 * - "override": existing providers (openai, anthropic, ...) are re-registered
 *   so their traffic goes through the Aperture gateway.
 * - "provider": a new provider named "aperture" is registered; its model list
 *   is discovered from GET <baseUrl>/v1/models on the gateway.
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
  applyApertureProvider,
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

    const { mode, providers, gatewayUrl } = await applyAperture(
      pi,
      ctx.modelRegistry,
    );

    if (
      mode === "override" &&
      ctx.model &&
      providers.includes(ctx.model.provider) &&
      gatewayUrl !== null &&
      configLoader.getConfig().checkGatewayModels.includes(ctx.model.provider)
    ) {
      const { missingModels } = await checkGatewayModels(
        gatewayUrl,
        ctx.modelRegistry,
      );
      notifyMissingModelsOnce(ctx, missingModels, warnedModels);
    }

    if (!ctx.model || !providers.includes(ctx.model.provider)) return;

    await refreshActiveModel(pi, ctx);
  });

  // Also check when user switches to a model whose provider is routed through
  // aperture (override mode only -- provider-mode models come from the
  // gateway by definition, so there's nothing to cross-check).
  pi.on("model_select", async (_event, ctx) => {
    if (!ctx?.model) return;

    const config = configLoader.getConfig();
    if (config.mode !== "override") return;
    if (!config.providers.includes(ctx.model.provider)) return;
    if (!config.checkGatewayModels.includes(ctx.model.provider)) return;

    const gatewayUrl = resolveProviderBaseUrl(config)?.replace("/v1", "");
    if (!gatewayUrl) return;

    const { missingModels } = await checkGatewayModels(
      gatewayUrl,
      ctx.modelRegistry,
    );
    notifyMissingModelsOnce(ctx, missingModels, warnedModels);
  });
}

function createConfigChangeHandler(
  pi: ExtensionAPI,
  warnedModels: Set<string>,
): (ctx: ExtensionContext) => void {
  let lastState = {
    mode: configLoader.getConfig().mode,
    providers: [...configLoader.getConfig().providers],
  };

  return (ctx: ExtensionContext) => {
    const current = configLoader.getConfig();
    const nextState = {
      mode: current.mode,
      providers: [...current.providers],
    };

    const plan = planConfigChange(lastState, nextState, ctx.model?.provider);

    void applyAperture(pi, ctx.modelRegistry).then(
      async ({ mode, providers, gatewayUrl }) => {
        if (
          mode === "override" &&
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

    lastState = nextState;

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

  // Provider mode: the "aperture" provider's model list comes entirely from
  // the gateway, so we can register it eagerly at extension load time --
  // ahead of any `before_agent_start` event. This matters because RPC
  // callers (e.g. `listModels`) may query the registry before the agent
  // runs. Override mode, in contrast, has to wait for other extensions to
  // register their providers, so its apply stays in the lifecycle hook.
  if (configLoader.getConfig().mode === "provider") {
    await applyApertureProvider(pi);
  }

  registerApertureLifecycleHook(pi, warnedModels);

  const onConfigChange = createConfigChangeHandler(pi, warnedModels);
  registerSetupCommand(pi, onConfigChange);
  registerApertureSettings(pi, onConfigChange);
}
