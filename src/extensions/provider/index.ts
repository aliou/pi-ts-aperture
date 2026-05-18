import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { getApiProvider } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { CachedModel } from "../../lib/config";
import { configLoader } from "../../lib/config";
import { fetchGatewayModels, type GatewayModel } from "../../lib/gateway";
import {
  buildCachedModelConfig,
  buildDefaultModelConfig,
  isDefaultModelConfig,
  PROVIDER_SEPARATOR,
  toCachedModel,
} from "../../lib/model-defaults";
import type {
  AssistantMessageEventStream,
  Context,
  SimpleStreamOptions,
} from "../../lib/types";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../lib/url";

const PROVIDER_NAME = "aperture";

const SYNC_SKILL_MD = `---
name: sync-aperture-models
description: Sync Aperture model capabilities into Pi's models.json. Use when dedicated mode models have wrong/missing capabilities (context window, reasoning, max tokens), or after adding new models to the Aperture gateway.
---

# Sync Aperture Model Metadata

Aperture dedicated mode registers all models with safe defaults: 128k context, 8k max tokens, no reasoning, text-only input. Real capabilities differ per model. This skill helps look up the actual values and update \`~/.pi/agent/models.json\`.

## Workflow

1. Read \`~/.pi/agent/extensions/aperture.json\` to get the Aperture gateway \`baseUrl\`
2. \`curl {baseUrl}/v1/models\` \u2014 list all models and their upstream providers
3. \`curl {baseUrl}/aperture/config\` \u2014 get upstream provider base URLs
4. **Ask user permission** before fetching external endpoints. List every URL.
5. For each upstream provider, \`curl {providerBaseurl}/v1/models\` \u2014 get model capabilities
6. If upstream doesn't return capability data, fall back to \`https://models.dev/api.json\`
7. Update \`~/.pi/agent/models.json\` under \`providers.aperture\`. The provider entry must include \`baseUrl\`, \`apiKey\`, \`api\`, and \`models\`. Only include models from **enabled** dedicated providers \u2014 check \`~/.pi/agent/extensions/aperture.json\` for \`dedicated.providers\` entries where \`enabled: true\`
8. \`/reload\`

## Before You Start

Read the Pi docs for \`models.json\` schema \u2014 look for the models.md documentation file in the Pi docs directory listed in your system prompt. Follow the schema exactly. Key rules:

- \`id\` and \`name\` are required on each model in the \`models\` array
- \`cost\` is optional but if present, **all four fields are required**: \`input\`, \`output\`, \`cacheRead\`, \`cacheWrite\`. Use \`0\` for unknown values. Do not omit any field.
- Costs in models.json are **per-million tokens** (e.g. $3/M tokens → \`3\`)
- \`aperture\` provider model IDs use format \`{providerId}::{modelId}\` with \`::\` separator
- \`input\` field only allows \`"text"\` and \`"image"\`. Upstream providers and models.dev may return \`"video"\`, \`"audio"\`, \`"pdf"\`, \`"file"\` \u2014 these are **not valid** in models.json. Map them: if a model supports image, pdf, video, or file input, set \`input: ["text", "image"]\`. Otherwise \`input: ["text"]\`.

## Required Provider Fields

The \`aperture\` provider in models.json must include:

\`\`\`json
{
  "providers": {
    "aperture": {
      "baseUrl": "{apertureGatewayUrl}/v1",
      "apiKey": "-",
      "api": "openai-completions",
      "models": [...]
    }
  }
}
\`\`\`

- \`baseUrl\` \u2014 Aperture gateway URL with \`/v1\` appended (e.g. \`http://ai.pango-lin.ts.net/v1\`). **Required.**
- \`apiKey\` \u2014 set to \`"-"\` (Aperture handles auth server-side)
- \`api\` \u2014 set to \`"openai-completions"\`

## Gateway Endpoints

\`GET {baseUrl}/v1/models\` returns:
- \`data[].id\` \u2014 model ID (may have \`hf:\` or \`~\` prefixes)
- \`data[].metadata.provider.id\` \u2014 upstream provider ID
- Aperture gateway \`pricing\` values are per-token USD — multiply by 1,000,000 for models.json per-million format

\`GET {baseUrl}/aperture/config\` returns \`{ "config": "<JSON string>" }\`. Parse the config string. It contains \`providers.{id}.baseurl\` \u2014 the upstream API base URL for each provider.

## Upstream Provider Discovery

For every provider from the Aperture config, fetch \`{baseurl}/v1/models\`.

OpenRouter returns rich data:
- \`context_length\` \u2014 max context window tokens
- \`architecture.input_modalities\` \u2014 e.g. \`["text", "image"]\`
- \`pricing.prompt\` / \`pricing.completion\` \u2014 per-token pricing strings

Other providers may return less or just standard OpenAI fields. Get what you can.

## models.dev Fallback

URL: \`https://models.dev/api.json\` (~1MB)

Structure: \`{ "<provider_id>": { "models": { "<model_id>": { "reasoning": bool, "limit": { "context": int, "output": int }, "modalities": { "input": [...] }, "cost": { "input": float, ... } } } } }\`

models.dev costs are already per-million tokens — use directly in models.json with no conversion. Aperture gateway pricing is per-token — multiply by 1,000,000 for models.json.

**Provider matching order:**
1. Match the Aperture provider name directly (e.g. \`synthetic\` \u2192 \`synthetic\` on models.dev, \`openrouter\` \u2192 \`openrouter\`)
2. If no match, use the model's org prefix as provider key (e.g. for \`neuralwatt::moonshotai/Kimi-K2.6\`, look under \`moonshotai\`)
3. Do not mix providers \u2014 a model running on \`synthetic\` uses \`synthetic\`'s data, not \`zhipuai\` or the model's original org

**Model ID mapping:** Strip Aperture prefixes when searching: \`hf:moonshotai/Kimi-K2.6\` \u2192 \`moonshotai/Kimi-K2.6\`, \`~anthropic/claude-sonnet-latest\` \u2192 \`anthropic/claude-sonnet-latest\`

## Manual Lookup

If the user declines external requests, point them to:
- OpenRouter: \`https://openrouter.ai/models\`
- models.dev: \`https://models.dev\`
- Provider docs (Anthropic, OpenAI, Google, DeepSeek, etc.)

Then update \`models.json\` with whatever info they provide.
`;

/** Write the sync skill to a temp directory and return its path.
 * The skill is inlined in code, so there are no relative path issues.
 */
function getSyncSkillPath(): string {
  const dir = join(tmpdir(), "pi-aperture-skill");
  mkdirSync(dir, { recursive: true });
  const skillPath = join(dir, "sync-aperture-models");
  mkdirSync(skillPath, { recursive: true });
  writeFileSync(join(skillPath, "SKILL.md"), SYNC_SKILL_MD);
  return skillPath;
}

const HEADERS = {
  Referer: "https://pi.dev",
  "X-Title": "npm:@aliou/pi-ts-aperture",
};

function getRequestModelId(modelId: string): string {
  const sepIndex = modelId.indexOf(PROVIDER_SEPARATOR);
  return sepIndex === -1
    ? modelId
    : modelId.slice(sepIndex + PROVIDER_SEPARATOR.length);
}

function getProviderId(modelId: string): string {
  const sepIndex = modelId.indexOf(PROVIDER_SEPARATOR);
  return sepIndex === -1 ? "" : modelId.slice(0, sepIndex);
}

function buildStreamSimple() {
  const builtIn = getApiProvider("openai-completions");
  if (!builtIn) return undefined;

  return (
    model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream =>
    builtIn.streamSimple(
      { ...model, id: getRequestModelId(model.id) },
      context,
      {
        ...options,
        headers: {
          ...options?.headers,
          "x-session-id": options?.sessionId ?? "",
          "x-upstream-provider-id": getProviderId(model.id),
        },
      },
    );
}

/** Filter cached models by enabled dedicated providers. */
function filterCachedModels(
  cached: CachedModel[],
  enabledProviderIds: Set<string>,
): CachedModel[] {
  return enabledProviderIds.size > 0
    ? cached.filter((m) => enabledProviderIds.has(m.providerId))
    : cached;
}

/** Filter gateway models by enabled dedicated providers. */
function filterGatewayModels(
  models: GatewayModel[],
  enabledProviderIds: Set<string>,
): GatewayModel[] {
  return enabledProviderIds.size > 0
    ? models.filter((m) => enabledProviderIds.has(m.providerId))
    : models;
}

/** Load user-defined model entries from models.json for the aperture provider. */
function loadUserModels(): Map<string, ProviderModelConfig> {
  const result = new Map<string, ProviderModelConfig>();
  try {
    const modelsPath = join(getAgentDir(), "models.json");
    if (!existsSync(modelsPath)) return result;
    const raw = JSON.parse(readFileSync(modelsPath, "utf-8"));
    const userModels = raw?.providers?.aperture?.models;
    if (!Array.isArray(userModels)) return result;
    for (const m of userModels) {
      if (m?.id) result.set(m.id, m as ProviderModelConfig);
    }
  } catch {
    // models.json missing or invalid — ignore
  }
  return result;
}

/** Merge default model configs with user-defined models from models.json.
 *
 * User-defined entries take precedence over defaults.
 * User models not in the gateway list are also included (manually added).
 */
function mergeWithUserModels(
  defaults: Map<string, ProviderModelConfig>,
  userModels: Map<string, ProviderModelConfig>,
): Map<string, ProviderModelConfig> {
  const merged = new Map<string, ProviderModelConfig>();

  // Start with defaults, override with user entries
  for (const [id, defaultCfg] of defaults) {
    merged.set(id, userModels.get(id) ?? defaultCfg);
  }

  // Include user models not in gateway (manually added)
  for (const [id, userCfg] of userModels) {
    if (!merged.has(id)) {
      merged.set(id, userCfg);
    }
  }

  return merged;
}

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const config = configLoader.getConfig();
  const gatewayUrl = resolveGatewayUrl(config);
  const baseUrl = resolveProviderBaseUrl(config);

  if (config.mode !== "dedicated" || !gatewayUrl || !baseUrl) return;

  const streamSimple = buildStreamSimple();

  const enabledProviderIds = new Set(
    config.dedicated.providers.filter((p) => p.enabled).map((p) => p.id),
  );

  // --- Register cached models immediately (no network) ---
  const cached = filterCachedModels(
    config.dedicated.cachedModels,
    enabledProviderIds,
  );
  const cachedModelConfigs: ProviderModelConfig[] = cached.map(
    buildCachedModelConfig,
  );

  if (cachedModelConfigs.length > 0) {
    pi.registerProvider(PROVIDER_NAME, {
      baseUrl,
      apiKey: "-",
      api: "openai-completions",
      headers: HEADERS,
      models: cachedModelConfigs,
      streamSimple,
    });
  }

  // --- Fetch fresh models in background, re-register if changed ---
  const gatewayModels = await fetchGatewayModels(gatewayUrl);
  const filteredModels = filterGatewayModels(gatewayModels, enabledProviderIds);

  // Build default configs for all gateway models
  const defaultModelConfigs = new Map<string, ProviderModelConfig>();
  for (const gm of filteredModels) {
    const cfg = buildDefaultModelConfig(gm);
    defaultModelConfigs.set(cfg.id, cfg);
  }

  // Merge with user-defined models from models.json
  // User-defined entries take precedence over defaults
  const userModels = loadUserModels();
  const mergedModels = mergeWithUserModels(defaultModelConfigs, userModels);
  const freshModelConfigs = [...mergedModels.values()];

  // Check if model list changed
  const cachedIds = new Set(cachedModelConfigs.map((m) => m.id));
  const freshIds = new Set(freshModelConfigs.map((m) => m.id));
  const changed =
    cachedIds.size !== freshIds.size ||
    [...freshIds].some((id) => !cachedIds.has(id));

  // Always re-register with fresh data (prices may have changed)
  if (freshModelConfigs.length > 0) {
    pi.registerProvider(PROVIDER_NAME, {
      baseUrl,
      apiKey: "-",
      api: "openai-completions",
      headers: HEADERS,
      models: freshModelConfigs,
      streamSimple,
    });
  }

  // Expose the sync-aperture-models skill only when models need syncing
  const defaultModels = freshModelConfigs.filter((m) =>
    isDefaultModelConfig(m),
  );
  if (defaultModels.length > 0) {
    const skillPath = getSyncSkillPath();
    pi.on("resources_discover", () => ({
      skillPaths: [skillPath],
    }));

    pi.on("session_start", (_event, ctx) => {
      const sample = defaultModels.slice(0, 3).map((m) => m.id);
      const more =
        defaultModels.length > 3 ? `, +${defaultModels.length - 3} more` : "";
      ctx.ui.notify(
        `[aperture] ${defaultModels.length} model(s) using default capabilities (128k ctx, 8k out, no reasoning): ${sample.join(", ")}${more}. Run /skill:sync-aperture-models to update.`,
        "info",
      );
    });
  }

  // Persist cache if models changed
  if (changed) {
    const allCached = gatewayModels.map(toCachedModel);
    await configLoader.save("global", {
      ...configLoader.getRawConfig("global"),
      dedicated: {
        ...configLoader.getRawConfig("global")?.dedicated,
        providers: config.dedicated.providers,
        cachedModels: allCached,
      },
    });
  }
}
