/**
 * Aperture onboarding extension.
 *
 * Owns temporary setup affordances: onboarding command, model sync skill,
 * metadata validation tools, and completion tool. It disables itself when
 * onboarding is marked complete.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configLoader } from "../../lib/config";
import { completeOnboardingTool } from "./complete-tool";
import {
  isOnboardingExtensionEnabled,
  isOnboardingPending,
} from "./onboarding";
import { registerOnboardingCommand } from "./setup-command";
import { getSyncSkillPath } from "./sync-skill";
import { validateModelsTool } from "./validate-models-tool";

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const globalConfig = configLoader.getRawConfig("global");
  if (!isOnboardingExtensionEnabled(globalConfig)) return;

  pi.on("session_start", (_event, ctx) => {
    if (isOnboardingPending(configLoader.getRawConfig("global"))) {
      ctx.ui.notify(
        "[aperture] extension installed. Run /aperture:onboarding to configure.",
        "info",
      );
    }
  });

  if (isOnboardingPending(globalConfig)) {
    registerOnboardingCommand(pi);
  }

  pi.registerTool(validateModelsTool);
  pi.registerTool(completeOnboardingTool);
  pi.on("resources_discover", () => ({
    skillPaths: [getSyncSkillPath()],
  }));
}
