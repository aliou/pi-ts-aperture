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
import type { ValidationError } from "@earendil-works/pi-schema";
import {
  compile,
  int,
  lit,
  map,
  num,
  obj,
  opt,
  type Static,
  str,
  union,
} from "@earendil-works/pi-schema";

export const APERTURE_SYSTEM_ONE_API = "typesafe-system-one";

const UsageSchema = obj({
  input_tokens: int({ minimum: 0 }),
  output_tokens: int({ minimum: 0 }),
});
const AnswerSchema = union([
  obj(
    {
      type: lit("choice"),
      choice: str(),
      probabilities: map(num()),
      confidence: num(),
    },
    { open: true },
  ),
  obj({ type: lit("score"), score: num(), confidence: num() }, { open: true }),
  obj({ type: lit("noul"), noul: num() }, { open: true }),
]);
const ErrorSchema = union([
  obj(
    {
      error: obj({ message: str(), type: str(), code: str() }, { open: true }),
    },
    { open: true },
  ),
  obj({ detail: str() }, { open: true }),
]);
const ResponseSchema = obj(
  { answers: map(AnswerSchema), usage: opt(UsageSchema) },
  { open: true },
);

const usageValidator = compile(UsageSchema);
const errorValidator = compile(ErrorSchema);
const responseValidator = compile(ResponseSchema);

type SystemOneResponse = Static<typeof ResponseSchema>;

class InvalidSystemOneResponseError extends Error {
  readonly body: unknown;

  constructor(body: unknown, errors: ValidationError[]) {
    super(errors.map(({ path, message }) => `${path}: ${message}`).join("; "));
    this.name = "InvalidSystemOneResponseError";
    this.body = body;
  }
}

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
  body: unknown,
) {
  const usage = (body as { usage?: unknown } | null)?.usage;
  return usageValidator.check(usage) ? mapUsage(model, usage) : undefined;
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
    if (!errorValidator.check(body)) {
      throw new InvalidSystemOneResponseError(
        body,
        errorValidator.errors(body),
      );
    }
    const message = "error" in body ? body.error.message : body.detail;
    throw new Error(
      `Aperture System One API returned ${response.status}: ${message}`,
    );
  }

  if (!responseValidator.check(body)) {
    throw new InvalidSystemOneResponseError(
      body,
      responseValidator.errors(body),
    );
  }
  return body;
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
    if (error instanceof InvalidSystemOneResponseError) {
      result.usage = billedUsageOnInvalidResponse(model, error.body);
      result.errorMessage = error.message;
      return result;
    }
    result.errorMessage =
      error instanceof Error ? error.message : String(error);
  }
  return result;
};
