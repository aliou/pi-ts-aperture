import {
  type ApertureProxyRoute,
  createApertureProxy,
} from "@aliou/pi-ts-aperture/proxy";
import type {
  Api,
  AssistantMessage,
  DeferredHandle,
  Model,
  Provider,
} from "@earendil-works/pi-ai";
import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const GATEWAY = "http://ai.pango-lin.ts.net";
const route: ApertureProxyRoute = { id: "local", gatewayId: "gateway-vendor" };

function model(id = "text-model", api: Api = "openai-completions"): Model<Api> {
  return {
    id,
    api,
    provider: "local",
    baseUrl: "https://upstream.example/v1",
    name: id,
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 8_192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

function doneStream(sent: Model<Api>, deferred?: DeferredHandle) {
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "OK" }],
    provider: sent.provider,
    api: sent.api,
    model: sent.id,
    stopReason: "stop",
    timestamp: 0,
    deferred,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

function nativeProvider() {
  let catalog = [model()];
  const native = {
    id: "local",
    name: "Local",
    auth: {
      apiKey: {
        check: vi.fn().mockResolvedValue({ type: "api_key", source: "faux" }),
        resolve: vi.fn().mockResolvedValue({
          auth: { apiKey: "faux-native", baseUrl: "https://auth.example/v1" },
          source: "faux",
        }),
      },
    },
    getModels: () => catalog,
    stream: vi.fn().mockImplementation((sent: Model<Api>) => doneStream(sent)),
    streamSimple: vi
      .fn()
      .mockImplementation((sent: Model<Api>) => doneStream(sent)),
  } satisfies Provider;
  return {
    native,
    changeCatalog: (next: Model<Api>[]) => {
      catalog = next;
    },
  };
}

function setup(routes = [route]) {
  const models = createModels();
  const fixture = nativeProvider();
  models.setProvider(fixture.native);
  const onWarning = vi.fn();
  const proxy = createApertureProxy({
    baseUrl: GATEWAY,
    providers: routes,
    getProvider: (id) => models.getProvider(id),
    registerProvider: (provider) => models.setProvider(provider),
    onWarning,
  });
  return { ...fixture, models, proxy, onWarning };
}

function catalog(
  passthrough = false,
  ids = ["text-model"],
  endpoints = ["/v1/chat/completions"],
) {
  return Response.json({
    data: ids.map((id) => ({
      id,
      supported_endpoints: endpoints,
      metadata: {
        provider: { id: route.gatewayId, requires_client_auth: passthrough },
      },
    })),
  });
}

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url) => {
    if (String(url) === `${GATEWAY}/v1/models`) return catalog();
    throw new Error(`Unexpected request: ${url}`);
  });
});
afterEach(() => vi.unstubAllGlobals());

test("plain pi-ai requests reach the gateway with placeholder auth and a qualified request ID", async () => {
  const models = createModels();
  models.setProvider(
    createProvider({
      id: "local",
      models: [model()],
      api: openAICompletionsApi(),
      auth: { apiKey: { resolve: async () => undefined } },
    }),
  );
  const proxy = createApertureProxy({
    baseUrl: GATEWAY,
    providers: [route],
    getProvider: (id) => models.getProvider(id),
    registerProvider: (provider) => models.setProvider(provider),
  });
  const result = await proxy.sync();
  expect(result).toEqual({ aborted: false, catalogError: undefined });
  const requestFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
  const [selected] = await models.getAvailable("local");
  const answer = await models.completeSimple(
    selected,
    { messages: [] },
    { fetch: requestFetch },
  );

  expect(answer.model).toBe("text-model");
  expect(answer.stopReason).toBe("stop");
  const [url, options] = requestFetch.mock.calls[0];
  const request = new Request(url, options);
  expect(request.url).toBe(`${GATEWAY}/v1/chat/completions`);
  expect(request.headers.get("authorization")).toBe("Bearer -");
  const body = await request.json();
  expect(body.model).toBe("gateway-vendor/text-model");
});

test("passthrough retains native auth and re-enforces the URL after auth resolution", async () => {
  fetchMock.mockResolvedValue(catalog(true));
  const { native, models, proxy } = setup();
  await proxy.sync();
  const [selected] = models.getModels("local");
  const answer = await models.completeSimple(selected, { messages: [] });
  expect(answer.model).toBe("text-model");
  expect(native.auth.apiKey.resolve).toHaveBeenCalled();
  expect(native.streamSimple.mock.calls[0][0]).toMatchObject({
    id: "gateway-vendor/text-model",
    baseUrl: `${GATEWAY}/v1`,
  });
  expect(native.streamSimple.mock.calls[0][2].apiKey).toBe("faux-native");
});

test("matching assistant envelopes use the request ID without changing stored history", async () => {
  const { native, models, proxy } = setup();
  await proxy.sync();
  const previous = await doneStream(model()).result();
  const other = { ...previous, provider: "other" };
  const messages = [previous, other];
  const snapshot = structuredClone(messages);
  const answer = await models.completeSimple(model(), { messages });
  const replay = native.streamSimple.mock.calls[0][1].messages;
  expect(replay[0].model).toBe("gateway-vendor/text-model");
  expect(replay[1].model).toBe("text-model");
  expect(messages).toEqual(snapshot);
  expect(answer.model).toBe("text-model");
});

test.each([
  "google-generative-ai",
  "google-vertex",
  "bedrock-converse-stream",
])("%s keeps path-embedded IDs bare", async (api) => {
  const { native, changeCatalog, models, proxy } = setup();
  changeCatalog([model("path-model", api)]);
  await proxy.sync();
  await models.completeSimple(model("path-model", api), { messages: [] });
  expect(native.streamSimple.mock.calls[0][0].id).toBe("path-model");
});

test("repeated sync reads a live native catalog and never layers stream wrappers", async () => {
  const { native, changeCatalog, models, proxy } = setup();
  await proxy.sync();
  changeCatalog([model(), model("added")]);
  await proxy.sync();
  expect(models.getModels("local").map((m) => m.id)).toEqual([
    "text-model",
    "added",
  ]);
  await models.completeSimple(model("added"), { messages: [] });
  expect(native.streamSimple).toHaveBeenCalledOnce();
  expect(native.streamSimple.mock.calls[0][0].id).toBe("gateway-vendor/added");
});

test("filter and override validation use the gateway ID; missing-model warnings use local IDs", async () => {
  const { models, proxy, onWarning, changeCatalog } = setup([
    { ...route, shouldCheckGatewayModels: true },
  ]);
  changeCatalog([model(), model("missing")]);
  await proxy.sync();
  expect(onWarning).toHaveBeenCalledWith(
    expect.stringContaining("local: missing"),
  );
  fetchMock.mockImplementation(async () =>
    catalog(false, ["text-model"], ["/v1/messages"]),
  );
  await proxy.sync({
    providers: [
      { ...route, keepGatewayModelsOnly: true, api: "anthropic-messages" },
    ],
  });
  expect(models.getModels("local")).toHaveLength(1);
  expect(models.getModels("local")[0]).toMatchObject({
    api: "anthropic-messages",
    baseUrl: GATEWAY,
  });
  await proxy.sync({ providers: [{ ...route, api: "google-vertex" }] });
  expect(models.getModels("local")[0].api).toBe("openai-completions");
  expect(onWarning).toHaveBeenCalledWith(
    expect.stringContaining("google-vertex"),
  );
});

test("API overrides dispatch through pi-ai rather than a pinned native stream", async () => {
  const { native, models, proxy } = setup();
  const result = await proxy.sync({
    providers: [{ ...route, api: "openai-completions" }],
  });
  expect(result.catalogError).toBeUndefined();
  const requestFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      ),
    );
  const answer = await models.completeSimple(
    models.getModels("local")[0],
    { messages: [] },
    { fetch: requestFetch },
  );
  expect(answer.stopReason).toBe("stop");
  expect(native.streamSimple).not.toHaveBeenCalled();
  expect(String(requestFetch.mock.calls[0][0])).toContain(GATEWAY);
});

test("catalog failures fail open and retain known passthrough auth", async () => {
  const { native, models, proxy } = setup([
    { ...route, keepGatewayModelsOnly: true },
  ]);
  fetchMock.mockResolvedValue(catalog(true));
  await proxy.sync();
  fetchMock.mockRejectedValue(new Error("offline"));
  const result = await proxy.sync();
  expect(result.catalogError?.message).toBe("offline");
  expect(models.getProvider("local")?.auth).toBe(native.auth);
  expect(models.getModels("local")).toHaveLength(1);
});

test("unknown gateway targets restore the native provider", async () => {
  const { native, models, proxy, onWarning } = setup();
  fetchMock.mockResolvedValue(Response.json({ data: [] }));
  await proxy.sync();
  expect(models.getProvider("local")).toBe(native);
  expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("not found"));
});

test("OpenAI subscription passthrough preserves native detection and redirects fetch", async () => {
  const { native, changeCatalog, models, proxy } = setup();
  changeCatalog([
    {
      ...model(),
      api: "openai-responses",
      baseUrl: "https://api.openai.com/v1",
    },
  ]);
  fetchMock.mockResolvedValue(catalog(true));
  await proxy.sync();
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response());
  await models.completeSimple(
    models.getModels("local")[0],
    { messages: [] },
    { fetch: transport },
  );
  const [sent, , options] = native.streamSimple.mock.calls[0];
  expect(sent.baseUrl).toBe("https://api.openai.com/v1");
  expect(sent.id).toBe("gateway-vendor/text-model");
  await options.fetch("https://api.openai.com/v1/responses");
  expect(transport).toHaveBeenCalledWith(
    new URL(`${GATEWAY}/v1/responses`),
    undefined,
  );
});

test("newer sync supersedes pending work even if fetch ignores cancellation", async () => {
  const { models, proxy } = setup();
  const old = Promise.withResolvers<Response>();
  fetchMock.mockImplementationOnce(() => old.promise);
  const pending = proxy.sync({
    providers: [{ ...route, api: "anthropic-messages" }],
  });
  const latest = await proxy.sync();
  expect(latest.aborted).toBe(false);
  const superseded = await pending;
  expect(superseded.aborted).toBe(true);
  old.resolve(catalog(false, ["text-model"], ["/v1/messages"]));
  await old.promise;
  expect(models.getModels("local")[0].api).toBe("openai-completions");
});

test("caller cancellation stops setup; restore prevents a late reinstall", async () => {
  const { native, models, proxy } = setup();
  const delayed = Promise.withResolvers<Response>();
  fetchMock.mockImplementation(() => delayed.promise);
  const controller = new AbortController();
  const pending = proxy.sync({ signal: controller.signal });
  expect(models.getProvider("local")).not.toBe(native);
  controller.abort();
  const cancelled = await pending;
  expect(cancelled.aborted).toBe(true);
  proxy.restore();
  delayed.resolve(catalog());
  await delayed.promise;
  expect(models.getProvider("local")).toBe(native);
});

test("restore invalidates pending setup without waiting for the gateway", async () => {
  const { native, models, proxy } = setup();
  const delayed = Promise.withResolvers<Response>();
  fetchMock.mockImplementationOnce(() => delayed.promise);
  const pending = proxy.sync();
  proxy.restore();
  const cancelled = await pending;
  expect(cancelled.aborted).toBe(true);
  delayed.resolve(catalog());
  await delayed.promise;
  expect(models.getProvider("local")).toBe(native);
  await proxy.sync();
  proxy.restore();
  expect(models.getProvider("local")).toBe(native);
});

test("a host replacement is neither overwritten by pending sync nor undone by restore", async () => {
  const { models, proxy } = setup();
  const delayed = Promise.withResolvers<Response>();
  fetchMock.mockImplementationOnce(() => delayed.promise);
  const pending = proxy.sync();
  const replacement = nativeProvider().native;
  models.setProvider(replacement);
  delayed.resolve(catalog());
  await pending;
  expect(models.getProvider("local")).toBe(replacement);
  proxy.restore();
  expect(models.getProvider("local")).toBe(replacement);
  await proxy.sync();
  proxy.restore();
  expect(models.getProvider("local")).toBe(replacement);
});

test("removing routes restores owned providers while untouched providers stay registered", async () => {
  const { models, native, proxy } = setup();
  const unrelated = { ...nativeProvider().native, id: "unrelated" };
  models.setProvider(unrelated);
  await proxy.sync();
  await proxy.sync({ providers: [] });
  expect(models.getProvider("local")).toBe(native);
  expect(models.getProvider("unrelated")).toBe(unrelated);
});

test("image and classifier operations keep their own APIs, route requests, and restore public IDs", async () => {
  const { native, models, proxy } = setup();
  const image = {
    ...model("shared"),
    type: "image" as const,
    api: "image-api",
    output: ["image" as const],
  };
  const classifier = {
    ...model("shared"),
    type: "classifier" as const,
    api: "classifier-api",
  };
  const generateImages = vi.fn().mockImplementation(async (m) => ({
    api: m.api,
    provider: m.provider,
    model: m.id,
    output: [],
    stopReason: "stop",
    timestamp: 0,
  }));
  const classify = vi.fn().mockImplementation(async (m) => ({
    api: m.api,
    provider: m.provider,
    model: m.id,
    answers: {},
    stopReason: "stop",
    timestamp: 0,
  }));
  models.setProvider({
    ...native,
    getAllModels: () => [...native.getModels(), image, classifier],
    generateImages,
    classify,
  });
  fetchMock.mockImplementation(async () =>
    catalog(false, ["text-model", "shared"], ["/v1/messages"]),
  );
  await proxy.sync({
    providers: [
      { ...route, keepGatewayModelsOnly: true, api: "anthropic-messages" },
    ],
  });
  expect(models.getModelsOfType("image")[0].api).toBe("image-api");
  expect(models.getModelsOfType("classifier")[0].api).toBe("classifier-api");
  const images = await models.generateImages(image, { input: [] });
  const classification = await models.classify(classifier, {
    state: {},
    questions: {},
  });
  expect(images.model).toBe("shared");
  expect(classification.model).toBe("shared");
  expect(generateImages.mock.calls[0][0]).toMatchObject({
    api: "image-api",
    id: "gateway-vendor/shared",
    baseUrl: `${GATEWAY}/v1`,
  });
  expect(classify.mock.calls[0][0]).toMatchObject({
    api: "classifier-api",
    id: "gateway-vendor/shared",
    baseUrl: `${GATEWAY}/v1`,
  });
  expect(generateImages.mock.calls[0][2].apiKey).toBe("-");
});

test("deferred poll/cancel route model and handle copies; incompatible overrides do not reach native operations", async () => {
  const { native, models, proxy } = setup();
  const handle: DeferredHandle = {
    id: "faux-response",
    provider: "local",
    modelId: "text-model",
    api: "openai-completions",
  };
  const fetchDeferred = vi.fn().mockImplementation(doneStream);
  const cancelDeferred = vi.fn().mockResolvedValue(undefined);
  models.setProvider({ ...native, fetchDeferred, cancelDeferred });
  await proxy.sync();
  const answer = await models.fetchDeferred(model(), handle);
  await models.cancelDeferred(model(), handle);
  expect(answer.model).toBe("text-model");
  expect(answer.deferred?.modelId).toBe("text-model");
  expect(handle.modelId).toBe("text-model");
  expect(fetchDeferred.mock.calls[0][0]).toMatchObject({
    id: "gateway-vendor/text-model",
    baseUrl: `${GATEWAY}/v1`,
  });
  expect(fetchDeferred.mock.calls[0][1].modelId).toBe(
    "gateway-vendor/text-model",
  );
  expect(cancelDeferred.mock.calls[0][1].modelId).toBe(
    "gateway-vendor/text-model",
  );
  const wrongProvider = await models.fetchDeferred(model(), {
    ...handle,
    provider: "other",
  });
  expect(wrongProvider.stopReason).toBe("error");
  await expect(
    models.cancelDeferred(model(), { ...handle, modelId: "other-model" }),
  ).rejects.toThrow("another model");
  fetchMock.mockImplementation(async () =>
    catalog(false, ["text-model"], ["/v1/messages"]),
  );
  await proxy.sync({ providers: [{ ...route, api: "anthropic-messages" }] });
  const incompatible = await models.fetchDeferred(
    models.getModels("local")[0],
    handle,
  );
  expect(incompatible.stopReason).toBe("error");
  expect(fetchDeferred).toHaveBeenCalledOnce();
});

test("a pre-aborted sync does not change established routing or remove its providers", async () => {
  const { models, proxy } = setup();
  await proxy.sync();
  const installed = models.getProvider("local");
  fetchMock.mockClear();
  const result = await proxy.sync({
    providers: [],
    signal: AbortSignal.abort(),
  });
  expect(result.aborted).toBe(true);
  expect(models.getProvider("local")).toBe(installed);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("latest sync keeps its gateway URL after a stale catalog completes", async () => {
  const { models, proxy } = setup();
  const delayed = Promise.withResolvers<Response>();
  fetchMock.mockImplementation(async () => catalog());
  fetchMock.mockImplementationOnce(() => delayed.promise);
  const pending = proxy.sync();
  const latest = await proxy.sync({
    baseUrl: "https://aperture.example.ts.net/v1",
  });
  expect(latest.aborted).toBe(false);
  const stale = await pending;
  expect(stale.aborted).toBe(true);
  delayed.resolve(catalog(true));
  await delayed.promise;
  expect(models.getModels("local")[0].baseUrl).toBe(
    "https://aperture.example.ts.net/v1",
  );
});

test("restoring from a warning callback invalidates the rest of setup", async () => {
  const { native, models, proxy, onWarning } = setup();
  onWarning.mockImplementation(() => proxy.restore());
  const result = await proxy.sync({
    providers: [{ ...route, gatewayId: "unknown" }],
  });
  expect(result.aborted).toBe(true);
  expect(models.getProvider("local")).toBe(native);
});

test("providers without API-key auth are not wrapped before catalog reconciliation", async () => {
  const { native, models, proxy } = setup();
  const source = { ...native, auth: undefined };
  models.setProvider(source);
  const delayed = Promise.withResolvers<Response>();
  fetchMock.mockImplementationOnce(() => delayed.promise);
  const pending = proxy.sync();
  expect(models.getProvider("local")).toBe(source);
  delayed.resolve(catalog());
  const result = await pending;
  expect(result.aborted).toBe(false);
  expect(models.getProvider("local")).not.toBe(source);
  const answer = await models.completeSimple(model(), { messages: [] });
  expect(answer.model).toBe("text-model");
  expect(native.streamSimple.mock.calls[0][2].apiKey).toBe("-");
});

test("native refresh and both filter operations retain their original receiver", async () => {
  const { native, models, proxy } = setup();
  const refreshModels = vi.fn(async function (this: Provider) {
    expect(this).toBe(source);
  });
  const filterModels = vi.fn(function (this: Provider) {
    expect(this).toBe(source);
    return [];
  });
  const filterAllModels = vi.fn(function (this: Provider) {
    expect(this).toBe(source);
    return [];
  });
  const source: Provider = {
    ...native,
    refreshModels,
    filterModels,
    filterAllModels,
  };
  models.setProvider(source);
  await proxy.sync();
  await models.refresh({ providers: ["local"] });
  expect(refreshModels).toHaveBeenCalled();
  filterModels.mockClear();
  filterAllModels.mockClear();
  const wrapped = models.getProvider("local");
  wrapped?.filterModels?.([]);
  wrapped?.filterAllModels?.([]);
  expect(filterModels).toHaveBeenCalledOnce();
  expect(filterAllModels).toHaveBeenCalledOnce();
});
