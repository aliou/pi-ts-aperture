/**
 * Per-model reasoning replay for the dedicated provider path.
 *
 * pi-ai replays prior-turn thinking under the field the stream recorded it
 * from (the first non-empty reasoning delta field becomes the thinking
 * block's signature). Some served templates render a different field, so the
 * replay is silently dropped from turn 2 on. The table maps exact model ids
 * to the field their template renders; the injector moves the replay there.
 */

import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";

/** Where to replay prior-turn thinking, plus optional chat template kwargs. */
export interface ReasoningReplay {
  field?: "reasoning" | "reasoning_content";
  templateKwargs?: Record<string, unknown>;
}

/**
 * Exact model-id knob table. Entries are added only with live-verified
 * evidence of the served template's replay field; matching is exact-string
 * only, never prefix or pattern — an unverified rename risks the inverse
 * failure (template renders `reasoning`, replay moved to `reasoning_content`).
 */
export const REASONING_REPLAY: Record<string, ReasoningReplay> = {
  // K3 renders only reasoning_content but streams reasoning (pi-neuralwatt #105).
  "kimi-k3": { field: "reasoning_content" },
  "kimi-k3-fast": { field: "reasoning_content" },
  "kimi-k3-flex": { field: "reasoning_content" },
  "hf:moonshotai/Kimi-K3": { field: "reasoning_content" },
  // Both fields render; kept uniform with the cross-repo catalog (pi-neuralwatt #102, #108).
  "deepseek-v4.1-flash": { field: "reasoning_content" },
  "hf:deepseek-ai/DeepSeek-V4.1-Flash": { field: "reasoning_content" },
  // Streams reasoning; the template renders only reasoning_content once tools are present (pi-synthetic #119).
  "syn:large:text": { field: "reasoning_content" },
  "syn:large:vision": { field: "reasoning_content" },
  // The template strips prior-turn thinking unless clear_thinking stays false (pi-synthetic #119).
  "hf:zai-org/GLM-5.3-Flash": {
    field: "reasoning_content",
    templateKwargs: { clear_thinking: false },
  },
};

/**
 * Validate an untrusted knob (gateway metadata or a restored model stamp).
 * Anything malformed yields undefined so callers fall back silently.
 */
export function parseReasoningReplay(
  value: unknown,
): ReasoningReplay | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const knob: ReasoningReplay = {};
  if (raw.field !== undefined) {
    if (raw.field !== "reasoning" && raw.field !== "reasoning_content") {
      return undefined;
    }
    knob.field = raw.field;
  }
  if (raw.templateKwargs !== undefined) {
    if (
      !raw.templateKwargs ||
      typeof raw.templateKwargs !== "object" ||
      Array.isArray(raw.templateKwargs)
    ) {
      return undefined;
    }
    knob.templateKwargs = raw.templateKwargs as Record<string, unknown>;
  }
  return knob.field || knob.templateKwargs ? knob : undefined;
}

/**
 * Resolve the knob for a stamped model id. A gateway-declared
 * `reasoning_replay` on the model's info entry wins over the repo table;
 * absent or invalid declarations fail open to the table. Table matching is
 * exact-string only: the qualified `<provider>/<modelId>` id first, then the
 * bare id after the first `/` (table keys are bare gateway ids).
 */
export function resolveReasoningReplay(
  modelId: string,
  modelInfo?: unknown,
): ReasoningReplay | undefined {
  const declared =
    modelInfo && typeof modelInfo === "object"
      ? parseReasoningReplay(
          (modelInfo as Record<string, unknown>).reasoning_replay,
        )
      : undefined;
  if (declared) return declared;
  const direct = REASONING_REPLAY[modelId];
  if (direct) return direct;
  const slash = modelId.indexOf("/");
  return slash === -1 ? undefined : REASONING_REPLAY[modelId.slice(slash + 1)];
}

/**
 * Move the recorded-signature replay into the knob's field on every assistant
 * message, and shallow-merge `templateKwargs` into `chat_template_kwargs`.
 * Move, never copy: a pre-set non-empty target wins and the duplicate source
 * is dropped — copying would re-create the #102 hazard (an empty target next
 * to a populated source makes the served template drop the replay).
 */
export function applyReasoningReplay(
  payload: unknown,
  knob: ReasoningReplay,
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const params = payload as Record<string, unknown>;
  if (knob.field && Array.isArray(params.messages)) {
    const source =
      knob.field === "reasoning_content" ? "reasoning" : "reasoning_content";
    for (const message of params.messages) {
      if (!message || typeof message !== "object") continue;
      const assistant = message as Record<string, unknown>;
      if (assistant.role !== "assistant") continue;
      const replay = assistant[source];
      if (typeof replay !== "string" || replay.length === 0) continue;
      const existing = assistant[knob.field];
      if (typeof existing !== "string" || existing.length === 0) {
        assistant[knob.field] = replay;
      }
      delete assistant[source];
    }
  }
  if (knob.templateKwargs) {
    const existing = params.chat_template_kwargs;
    params.chat_template_kwargs = {
      ...(existing && typeof existing === "object" && !Array.isArray(existing)
        ? existing
        : {}),
      ...knob.templateKwargs,
    };
  }
  return params;
}

/**
 * Chain the replay transform after the caller's own `onPayload`: the caller
 * runs first on the original payload, and the transform operates on its
 * replacement when it returns one. All other options pass through untouched.
 */
export function wrapReasoningReplayOnPayload<
  TOptions extends Pick<StreamOptions, "onPayload">,
>(options: TOptions | undefined, knob: ReasoningReplay): TOptions {
  const caller = options?.onPayload;
  const onPayload: NonNullable<StreamOptions["onPayload"]> = async (
    payload: unknown,
    model: Model<Api>,
  ) => {
    const replacement = await caller?.(payload, model);
    return applyReasoningReplay(
      replacement === undefined ? payload : replacement,
      knob,
    );
  };
  return { ...options, onPayload } as TOptions;
}
