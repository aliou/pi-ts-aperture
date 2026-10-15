import type {
  ClassifierAnswer,
  ClassifierApi,
  ClassifierContext,
  ClassifierFunction,
  ClassifierModel,
  ClassifierOptions,
  ClassifierResult,
} from "@earendil-works/pi-ai";
import { calculateCost } from "@earendil-works/pi-ai";
import type { Static } from "typebox";
import { Type } from "typebox";
import { Check, Parse, ParseError } from "typebox/value";

export const APERTURE_SYSTEM_ONE_API = "typesafe-system-one";

const UsageSchema = Type.Object({
  input_tokens: Type.Integer({ minimum: 0 }),
  output_tokens: Type.Integer({ minimum: 0 }),
});
const AnswerSchemas = {
  choice: Type.Object({
    type: Type.Literal("choice"),
    choice: Type.String(),
    probabilities: Type.Record(Type.String(), Type.Number()),
    confidence: Type.Number(),
  }),
  score: Type.Object({
    type: Type.Literal("score"),
    score: Type.Number(),
    confidence: Type.Number(),
  }),
  bool: Type.Object({ type: Type.Literal("noul"), noul: Type.Number() }),
};
const ErrorSchema = Type.Union([
  Type.Object({
    error: Type.Object({
      message: Type.String(),
      type: Type.String(),
      code: Type.String(),
    }),
  }),
  Type.Object({ detail: Type.String() }),
]);

function responseSchema(context: ClassifierContext) {
  return Type.Object({
    answers: Type.Object(
      Object.fromEntries(
        Object.entries(context.questions).map(([id, question]) => [
          id,
          AnswerSchemas[question.type],
        ]),
      ),
    ),
    usage: Type.Optional(UsageSchema),
  });
}

type SystemOneResponse = Static<ReturnType<typeof responseSchema>>;

function mapAnswer(
  value: SystemOneResponse["answers"][string],
): ClassifierAnswer {
  if (value.type === "noul") return { type: "bool", probability: value.noul };
  if (value.type === "score")
    return { type: "score", score: value.score, confidence: value.confidence };
  return {
    type: "choice",
    choice: value.choice,
    probabilities: value.probabilities,
    confidence: value.confidence,
  };
}

function mapUsage(
  model: ClassifierModel<ClassifierApi>,
  value: SystemOneResponse["usage"],
): ClassifierResult["usage"] {
  if (!value) return undefined;
  const { input_tokens: input, output_tokens: output } = value;
  const usage = {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
  calculateCost(model, usage);
  return usage;
}

function billedUsageOnInvalidResponse(
  model: ClassifierModel<ClassifierApi>,
  error: ParseError,
) {
  const usage = (error.cause.value as { usage?: unknown } | null)?.usage;
  return Check(UsageSchema, usage) ? mapUsage(model, usage) : undefined;
}

function formatRequest(
  model: ClassifierModel<ClassifierApi>,
  context: ClassifierContext,
) {
  return {
    model: model.id,
    state: context.state,
    questions: Object.fromEntries(
      Object.entries(context.questions).map(([id, question]) => [
        id,
        question.type === "bool" ? { ...question, type: "noul" } : question,
      ]),
    ),
  };
}

function requestHeaders(
  model: ClassifierModel<ClassifierApi>,
  options: ClassifierOptions,
) {
  const headers = new Headers({
    authorization: `Bearer ${options.apiKey || "-"}`,
    "content-type": "application/json",
  });
  const overrides = [model.headers, options.headers].flatMap((source) =>
    Object.entries(source ?? {}),
  );
  for (const [name, value] of overrides) {
    if (value === null) headers.delete(name);
    else headers.set(name, value);
  }
  return Object.fromEntries(headers);
}

function requestSignal({ signal, timeoutMs }: ClassifierOptions) {
  if (timeoutMs === undefined) return signal;
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function request(
  model: ClassifierModel<ClassifierApi>,
  context: ClassifierContext,
  options: ClassifierOptions,
) {
  if (model.api !== APERTURE_SYSTEM_ONE_API) {
    throw new Error(`Unsupported classifier API: ${model.api}`);
  }

  options.signal?.throwIfAborted();

  const rawPayload = formatRequest(model, context);
  const hookPayload = await options.onPayload?.(rawPayload, model);
  const payload = hookPayload ?? rawPayload;

  const url = new URL("systemone", `${model.baseUrl.replace(/\/+$/u, "")}/`);

  const requestFetch = options.fetch ?? globalThis.fetch;

  const response = await requestFetch(url, {
    method: "POST",
    headers: requestHeaders(model, options),
    body: JSON.stringify(payload),
    signal: requestSignal(options),
  });

  await options.onResponse?.(
    { status: response.status, headers: Object.fromEntries(response.headers) },
    model,
  );

  const body: unknown = await response.json();
  if (!response.ok) {
    const failure = Parse(ErrorSchema, body);
    const message = "error" in failure ? failure.error.message : failure.detail;
    throw new Error(
      `Aperture System One API returned ${response.status}: ${message}`,
    );
  }

  return Parse(responseSchema(context), body);
}

export const classify: ClassifierFunction = async (
  model,
  context,
  options = {},
) => {
  const result: ClassifierResult = {
    api: model.api,
    provider: model.provider,
    model: model.id,
    answers: {},
    stopReason: "stop",
    timestamp: Date.now(),
  };
  try {
    const body = await request(model, context, options);
    result.usage = mapUsage(model, body.usage);
    result.answers = Object.fromEntries(
      Object.keys(context.questions).map((id) => [
        id,
        mapAnswer(body.answers[id]),
      ]),
    );
  } catch (error) {
    result.stopReason = options.signal?.aborted ? "aborted" : "error";
    if (error instanceof ParseError) {
      result.usage = billedUsageOnInvalidResponse(model, error);
      result.errorMessage = error.cause.errors
        .map(({ instancePath, message }) => `${instancePath}: ${message}`)
        .join("; ");
      return result;
    }
    result.errorMessage =
      error instanceof Error ? error.message : String(error);
  }
  return result;
};
