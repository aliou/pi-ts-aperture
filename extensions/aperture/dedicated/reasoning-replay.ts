import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import {
  parseReasoningReplay,
  type ReasoningReplay,
  resolveReasoningReplay,
  wrapReasoningReplayOnPayload,
} from "../../../src/reasoning-replay";

/**
 * Extra property `buildModels` stamps onto dedicated models whose catalog
 * entry resolved a knob. The stamp survives the models-store round-trip, so
 * cache-only restores keep replaying; when it is lost (a user redefinition in
 * `models.json` rebuilds the model), the repo table still applies by id.
 */
export interface ReasoningReplayStamp {
  reasoningReplay?: ReasoningReplay;
}

/**
 * Knob for one streamed model: the catalog stamp first (a gateway-declared
 * `reasoning_replay` override only ever arrives there), then the repo table
 * by the stamped qualified id.
 */
export function reasoningReplayFor(
  model: Model<Api>,
): ReasoningReplay | undefined {
  const stamped = parseReasoningReplay(
    (model as Model<Api> & ReasoningReplayStamp).reasoningReplay,
  );
  return stamped ?? resolveReasoningReplay(model.id);
}

/**
 * Stream-options wrapper for the dedicated provider. Applies the replay knob
 * on the openai-completions surface only (anthropic thinking replays natively
 * with signatures); knob-less models and other APIs get the options back
 * unchanged, so their payloads stay byte-identical.
 */
export function withReasoningReplay<TOptions extends StreamOptions>(
  model: Model<Api>,
  options: TOptions | undefined,
): TOptions | undefined {
  if (model.api !== "openai-completions") return options;
  const knob = reasoningReplayFor(model);
  if (!knob) return options;
  return wrapReasoningReplayOnPayload(options, knob);
}
