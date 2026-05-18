import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SYNC_SKILL_MD = `---
name: sync-aperture-models
description: Sync Aperture model capabilities into Pi's models.json. Use when dedicated mode models have wrong/missing capabilities (context window, reasoning, max tokens, modalities), after adding new models to the Aperture gateway, or when Aperture provider compatibility changed.
---

# Sync Aperture Model Metadata

Aperture dedicated mode discovers models from the gateway and registers them in Pi. The gateway exposes model IDs, upstream providers, provider compatibility, and pricing, but not every model's full capabilities. This skill helps update \`~/.pi/agent/models.json\` with accurate per-model metadata.

## Workflow

1. Read \`~/.pi/agent/extensions/aperture.json\` to get the Aperture gateway \`baseUrl\` and enabled dedicated providers.
2. Fetch \`{baseUrl}/v1/models\` to list models and upstream provider IDs.
3. Fetch \`{baseUrl}/aperture/config\` to read provider compatibility flags and upstream base URLs.
4. Fetch \`https://models.dev/api.json\` for model capabilities. Treat models.dev as the primary source for capabilities, regardless of which Aperture provider routes the model.
5. Ask user permission before fetching external upstream provider endpoints. List every URL.
6. For each upstream provider, fetch \`{providerBaseurl}/v1/models\` when that endpoint exists. Use this only as supplemental metadata when models.dev has no match.
7. Update \`~/.pi/agent/models.json\` under \`providers.aperture.models\`. Only include models from enabled dedicated providers.
8. Call \`aperture_validate_models_json\` and fix every reported error before continuing.
9. Run \`/reload\` only after validation passes.

## Aperture Compatibility Mapping

Dedicated mode maps Aperture provider compatibility to Pi APIs:

- \`openai_chat\` -> \`openai-completions\` with \`{baseUrl}/v1\`
- \`anthropic_messages\` -> \`anthropic-messages\` with \`{baseUrl}\`
- \`openai_responses\` -> \`openai-responses\` with \`{baseUrl}/v1\`
- \`gemini_generate_content\` -> \`google-generative-ai\` with \`{baseUrl}/v1beta\`
- \`google_generate_content\` -> \`google-vertex\` with \`{baseUrl}/v1\`
- \`bedrock_converse\` -> \`bedrock-converse-stream\` with \`{baseUrl}/v1\`

Prefer \`openai_chat\` when a provider supports it, because it is Aperture's broadest compatibility path for Pi tool use.

## models.json Rules

- The \`aperture\` provider entry should keep \`baseUrl\`, \`apiKey\`, and default \`api\` for fallback compatibility.
- Do not set per-model \`api\` or \`baseUrl\` for Aperture dedicated models unless the user explicitly asks. The extension routes each \`{providerId}::{modelId}\` through the right Aperture compatibility path at runtime.
- Model IDs use \`{providerId}::{modelId}\`.
- \`id\` and \`name\` are required.
- Every model must include capability fields: \`reasoning\`, \`input\`, \`contextWindow\`, and \`maxTokens\`. Pi's schema treats these as optional, but Aperture sync must fill them so reasoning options and context limits work correctly.
- \`cost\` is optional, but if present all four fields are required: \`input\`, \`output\`, \`cacheRead\`, \`cacheWrite\`. Use \`0\` for missing values; never write partial cost objects.
- Costs in models.json are per-million tokens. Aperture gateway pricing is per-token USD, so multiply by 1,000,000 if copying gateway prices manually.
- \`input\` only allows \`text\` and \`image\`. Map file/pdf/video-capable models to \`["text", "image"]\` when image-like inputs are supported.

## Data Sources

Gateway endpoints:

- \`GET {baseUrl}/v1/models\`: model IDs, provider IDs, pricing.
- \`GET {baseUrl}/aperture/config\`: provider compatibility and upstream base URLs.

Capability metadata:

- \`https://models.dev/api.json\`: primary source for model capabilities, modalities, reasoning, and limits.
- Gateway pricing remains the primary source for \`cost\`; use models.dev costs only when gateway pricing is unavailable.

## Capability Matching

Do not assume the Aperture provider ID is the model author. A model routed through OpenRouter, Synthetic, or another gateway provider can still be an Anthropic, OpenAI, Google, Moonshot, Qwen, or other authored model.

For each Aperture model:

1. Remove only the Aperture routing prefix from \`{providerId}::{modelId}\`.
2. Search models.dev globally across all providers and all model IDs.
3. Prefer exact matches first.
4. Then use provider-qualified matches already present in the model ID, such as \`anthropic/claude-sonnet-4-5\`.
5. Then use suffix matches only when unambiguous, such as \`claude-sonnet-4-5\` matching one known \`*/claude-sonnet-4-5\` entry.
6. Use models.dev aliases if present.
7. Do not hardcode deployment-specific prefixes or provider-specific cleanup rules. If a model ID has custom routing syntax and no confident match is possible, fall back safely.

When models.dev has a confident match, copy capabilities from that match: \`reasoning\`, \`input\`, \`contextWindow\`, \`maxTokens\`, and \`output\` when available. Do not replace these with weaker gateway/provider defaults.

If exact metadata cannot be found, write safe defaults rather than omitting fields: \`reasoning: false\`, \`input: ["text"]\`, \`contextWindow: 128000\`, and \`maxTokens: 8192\`.
`;

/** Write the sync skill to a temp directory and return its path.
 * The skill is inlined in code, so there are no relative path issues.
 */
export function getSyncSkillPath(): string {
  const dir = join(tmpdir(), "pi-aperture-skill");
  mkdirSync(dir, { recursive: true });
  const skillPath = join(dir, "sync-aperture-models");
  mkdirSync(skillPath, { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), SYNC_SKILL_MD);
  return skillPath;
}
