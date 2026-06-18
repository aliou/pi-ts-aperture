import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { configLoader } from "../shared/config/loader";
import {
  isOnboardingExtensionEnabled,
  isOnboardingPending,
} from "./onboarding";
import { registerOnboardingCommand } from "./setup-command";

export function registerOnboarding(pi: ExtensionAPI): void {
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
}
