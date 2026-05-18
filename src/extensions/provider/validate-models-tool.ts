import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface ValidateModelsDetails {
  ok: boolean;
  error?: string;
  path: string;
}

export const validateModelsTool = defineTool({
  name: "aperture_validate_models_json",
  label: "Validate Aperture models.json",
  description:
    "Validate Pi's models.json schema after editing Aperture dedicated-mode model metadata.",
  promptSnippet:
    "Validate Pi's models.json after editing Aperture dedicated-mode model metadata.",
  promptGuidelines: [
    "Use aperture_validate_models_json after editing ~/.pi/agent/models.json for Aperture model metadata and before asking the user to reload Pi.",
    "If aperture_validate_models_json reports a cost error, ensure every model cost object includes input, output, cacheRead, and cacheWrite numeric fields.",
  ],
  parameters: Type.Object({}),

  async execute(
    _toolCallId,
    _params,
    _signal,
    _onUpdate,
    ctx,
  ): Promise<AgentToolResult<ValidateModelsDetails>> {
    ctx.modelRegistry.refresh();
    const error = ctx.modelRegistry.getError();
    const path = join(getAgentDir(), "models.json");

    if (error) {
      return {
        content: [
          {
            type: "text",
            text: `models.json is invalid.\n\n${error}`,
          },
        ],
        details: { ok: false, error, path },
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `models.json is valid.\n\nFile: ${path}`,
        },
      ],
      details: { ok: true, path },
    };
  },
});
