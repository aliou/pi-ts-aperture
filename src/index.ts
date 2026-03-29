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
import { planConfigChange } from "./core";
import { applyAperture, refreshActiveModel } from "./providers/aperture";

function registerApertureLifecycleHook(pi: ExtensionAPI): void {
  const warnedModels = new Set<string>();

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!ctx?.modelRegistry) return;

    const { providers: overriddenProviders, missingModels } =
      await applyAperture(pi, ctx.modelRegistry);

    const newMissing = missingModels.filter((id) => !warnedModels.has(id));
    if (newMissing.length > 0) {
      for (const id of newMissing) warnedModels.add(id);
      ctx.ui.notify(
        `[aperture] models not available on gateway: ${newMissing.join(", ")}. Add them to the gateway configuration.`,
        "warning",
      );
    }

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

    const plan = planConfigChange(
      lastRegisteredProviders,
      providers,
      ctx.model?.provider,
    );

    void applyAperture(pi, ctx.modelRegistry).then(({ missingModels }) => {
      if (missingModels.length > 0) {
        ctx.ui.notify(
          `[aperture] models not available on gateway: ${missingModels.join(", ")}. Add them to the gateway configuration.`,
          "warning",
        );
      }
    });
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

  registerApertureLifecycleHook(pi);

  const onConfigChange = createConfigChangeHandler(pi);
  registerSetupCommand(pi, onConfigChange);
  registerApertureSettings(pi, onConfigChange);
}
