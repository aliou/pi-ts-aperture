import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { configLoader } from "../../lib/config";

interface CompleteOnboardingDetails {
  onboardingDone: true;
  onboardingEnabled: false;
}

export const completeOnboardingTool = defineTool({
  name: "aperture_complete_onboarding",
  label: "Complete Aperture onboarding",
  description:
    "Mark Aperture onboarding as complete and disable Aperture onboarding tools and skills.",
  promptSnippet:
    "Mark Aperture onboarding as complete after Aperture setup and model metadata validation are done.",
  promptGuidelines: [
    "Use aperture_complete_onboarding only after Aperture setup is complete and Aperture model metadata validation passes.",
  ],
  parameters: Type.Object({}),

  async execute(): Promise<AgentToolResult<CompleteOnboardingDetails>> {
    const raw = configLoader.getRawConfig("global") ?? {};
    await configLoader.save("global", {
      ...raw,
      onboardingDone: true,
      onboarding: {
        ...raw.onboarding,
        enabled: false,
      },
    });
    await configLoader.load();

    return {
      content: [
        {
          type: "text",
          text: "Aperture onboarding marked complete. Onboarding tools and skills are disabled after /reload.",
        },
      ],
      details: {
        onboardingDone: true,
        onboardingEnabled: false,
      },
    };
  },
});
