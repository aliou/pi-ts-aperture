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
4. Ask user permission before fetching external provider endpoints. List every URL.
5. For each upstream provider, fetch \`{providerBaseurl}/v1/models\` when that endpoint exists.
6. If upstream data is missing, fall back to \`https://models.dev/api.json\`.
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
- Each model can override \`api\` and \`baseUrl\` when its upstream provider is not OpenAI-chat compatible.
- Model IDs use \`{providerId}::{modelId}\`.
- \`id\` and \`name\` are required.
- \`cost\` is optional, but if present all four fields are required: \`input\`, \`output\`, \`cacheRead\`, \`cacheWrite\`. Use \`0\` for missing values; never write partial cost objects.
- Costs in models.json are per-million tokens. Aperture gateway pricing is per-token USD, so multiply by 1,000,000 if copying gateway prices manually.
- \`input\` only allows \`text\` and \`image\`. Map file/pdf/video-capable models to \`["text", "image"]\` when image-like inputs are supported.

## Data Sources

Gateway endpoints:

- \`GET {baseUrl}/v1/models\`: model IDs, provider IDs, pricing.
- \`GET {baseUrl}/aperture/config\`: provider compatibility and upstream base URLs.

Fallback metadata:

- \`https://models.dev/api.json\`: model capabilities, costs, modalities, reasoning, limits.

Strip Aperture-specific prefixes before lookup where useful: \`hf:moonshotai/Kimi-K2.6\` -> \`moonshotai/Kimi-K2.6\`, \`~anthropic/claude-sonnet-latest\` -> \`anthropic/claude-sonnet-latest\`.
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
