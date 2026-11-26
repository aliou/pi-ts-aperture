import type {
  ClassifierAnswer,
  ClassifierApi,
  ClassifierContext,
  ClassifierFunction,
  ClassifierModel,
  ClassifierOptions,
  ClassifierQuestion,
  ClassifierResult,
} from "@earendil-works/pi-ai";
import { calculateCost } from "@earendil-works/pi-ai";
import type { ValidationError } from "@earendil-works/pi-schema";
import {
  arr,
  compile,
  int,
  lit,
  num,
  obj,
  opt,
  type Static,
  str,
  union,
} from "@earendil-works/pi-schema";

export const APERTURE_OPENAI_DECISIONS_API = "openai-decisions";

const ProbabilitySchema = obj({ value: str(), probability: num() });
const UsageSchema = obj(
  {
    input_tokens: int({ minimum: 0 }),
    output_tokens: int({ minimum: 0 }),
  },
  { open: true },
);
const AnswerSchema = union([
  obj(
    {
      type: lit("choice"),
      name: str(),
      choice: str(),
      probabilities: opt(arr(ProbabilitySchema)),
      confidence: num(),
    },
    { open: true },
  ),
  obj(
    {
      type: lit("score"),
      name: str(),
      score: num(),
      confidence: num(),
    },
    { open: true },
  ),
  obj(
    { type: lit("predicate"), name: str(), probability: num() },
    {
      open: true,
    },
  ),
  obj({ type: lit("refusal"), name: str() }, { open: true }),
]);
const ErrorSchema = union([
  obj(
    {
      error: obj({ message: str(), type: str(), code: str() }, { open: true }),
    },
    { open: true },
  ),
]);
const ResponseSchema = obj(
  { answers: arr(AnswerSchema), usage: opt(UsageSchema) },
  { open: true },
);

const usageValidator = compile(UsageSchema);
const errorValidator = compile(ErrorSchema);
const responseValidator = compile(ResponseSchema);

type DecisionsResponse = Static<typeof ResponseSchema>;

class InvalidDecisionsResponseError extends Error {
  readonly body: unknown;

  constructor(body: unknown, errors: ValidationError[]) {
    super(errors.map(({ path, message }) => `${path}: ${message}`).join("; "));
    this.name = "InvalidDecisionsResponseError";
    this.body = body;
  }
}

function predicateInstructions(
  question: ClassifierQuestion & {
    type: "bool";
  },
): string {
  const meanings = [
    question.criteria.true ? `True means: ${question.criteria.true}` : "",
    question.criteria.false ? `False means: ${question.criteria.false}` : "",
  ].filter(Boolean);
  return meanings.length > 0
    ? `${question.instructions}\n\n${meanings.join("\n")}`
    : question.instructions;
}

function wireQuestion(id: string, question: ClassifierQuestion) {
  if (question.type === "choice") {
    return {
      type: "choice",
      name: id,
      instructions: question.instructions,
      choices: Object.entries(question.criteria).map(([value, description]) =>
        description ? { value, description } : { value },
      ),
    };
  }
  if (question.type === "score") {
    return {
      type: "score",
      name: id,
      instructions: question.instructions,
      levels: question.criteria.map((label) => ({ label })),
    };
  }
  return {
    type: "predicate",
    name: id,
    instructions: predicateInstructions(question),
  };
}

function wireInput(context: ClassifierContext) {
  const state = JSON.stringify(context.state);
  const images = context.images ?? [];
  if (images.length === 0) return state;
  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: state },
        ...images.map((image) => ({
          type: "input_image",
          image_url: `data:${image.mimeType};base64,${image.data}`,
        })),
      ],
    },
  ];
}

function mapUsage(
  model: ClassifierModel<ClassifierApi>,
  value: DecisionsResponse["usage"],
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

function mapAnswer(
  id: string,
  value: DecisionsResponse["answers"][number],
): ClassifierAnswer {
  if (value.type === "refusal") {
    throw new Error(`OpenAI Decisions API refused to answer ${id}`);
  }
  if (value.type === "predicate") {
    return { type: "bool", probability: value.probability };
  }
  if (value.type === "score") {
    return { type: "score", score: value.score, confidence: value.confidence };
  }
  return {
    type: "choice",
    choice: value.choice,
    probabilities: Object.fromEntries(
      (value.probabilities ?? []).map((entry) => [
        entry.value,
        entry.probability,
      ]),
    ),
    confidence: value.confidence,
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
  if (model.api !== APERTURE_OPENAI_DECISIONS_API) {
    throw new Error(`Unsupported classifier API: ${model.api}`);
  }

  options.signal?.throwIfAborted();

  const rawPayload = {
    model: model.id,
    input: wireInput(context),
    questions: Object.entries(context.questions).map(([id, question]) =>
      wireQuestion(id, question),
    ),
  };
  const hookPayload = await options.onPayload?.(rawPayload, model);
  const payload = hookPayload ?? rawPayload;

  const url = new URL("decisions", `${model.baseUrl.replace(/\/+$/u, "")}/`);

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
      throw new InvalidDecisionsResponseError(
        body,
        errorValidator.errors(body),
      );
    }
    const message = "error" in body ? body.error.message : "unknown error";
    throw new Error(
      `Aperture OpenAI Decisions API returned ${response.status}: ${message}`,
    );
  }

  if (!responseValidator.check(body)) {
    throw new InvalidDecisionsResponseError(
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
    const byName = new Map(body.answers.map((answer) => [answer.name, answer]));
    result.answers = Object.fromEntries(
      Object.keys(context.questions).map((id) => {
        const answer = byName.get(id);
        if (!answer) {
          throw new Error(
            `OpenAI Decisions API did not return an answer for ${id}`,
          );
        }
        return [id, mapAnswer(id, answer)];
      }),
    );
  } catch (error) {
    result.stopReason = options.signal?.aborted ? "aborted" : "error";
    if (error instanceof InvalidDecisionsResponseError) {
      result.usage = billedUsageOnInvalidResponse(model, error.body);
      result.errorMessage = error.message;
      return result;
    }
    result.errorMessage =
      error instanceof Error ? error.message : String(error);
  }
  return result;
};
