import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { defineTool, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

interface ValidateModelsDetails {
  ok: boolean;
  error?: string;
  warnings: string[];
  path: string;
}

function validateApertureModelMetadata(path: string): string[] {
  if (!existsSync(path)) return [];

  const raw = JSON.parse(readFileSync(path, "utf-8"));
  const models = raw?.providers?.aperture?.models;
  if (!Array.isArray(models)) return [];

  const warnings: string[] = [];
  for (const [index, model] of models.entries()) {
    const label = model?.id ? `model ${model.id}` : `models[${index}]`;
    const missing = [];
    if (typeof model?.reasoning !== "boolean") missing.push("reasoning");
    if (!Array.isArray(model?.input)) missing.push("input");
    if (typeof model?.contextWindow !== "number") missing.push("contextWindow");
    if (typeof model?.maxTokens !== "number") missing.push("maxTokens");
    if (missing.length > 0) {
      warnings.push(`${label}: missing ${missing.join(", ")}`);
    }
  }
  return warnings;
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
    const warnings = error ? [] : validateApertureModelMetadata(path);

    if (error) {
      return {
        content: [
          {
            type: "text",
            text: `models.json is invalid.\n\n${error}`,
          },
        ],
        details: { ok: false, error, warnings, path },
      };
    }

    if (warnings.length > 0) {
      return {
        content: [
          {
            type: "text",
            text: `models.json schema is valid, but Aperture model metadata is incomplete.\n\n${warnings.map((w) => `- ${w}`).join("\n")}\n\nFile: ${path}`,
          },
        ],
        details: { ok: false, warnings, path },
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `models.json is valid.\n\nFile: ${path}`,
        },
      ],
      details: { ok: true, warnings, path },
    };
  },
});
