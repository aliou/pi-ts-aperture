import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({ resolve(specifier, context, next) {
  assert(!/pi-coding-agent|pi-tui|pi-utils-|config.*loader/.test(specifier), specifier);
  return next(specifier, context);
} });

const { createApertureProvider } = await import("@aliou/pi-ts-aperture/provider");
const { createApertureProxy } = await import("@aliou/pi-ts-aperture/proxy");
const { builtinModels } = await import("@earendil-works/pi-ai/providers/all");
const { createProvider } = await import("@earendil-works/pi-ai");
const { openAICompletionsApi } = await import("@earendil-works/pi-ai/api/openai-completions.lazy");
const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
const { AssistantEntry, Harness, MemoryStorage, createRegistry } = await import("@earendil-works/pi-durable");

const GATEWAY = "http://ai.pango-lin.ts.net";
let modelRequests = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === "https://models.dev/api.json") return Response.json({});
  if (url === `${GATEWAY}/v1/models`) {
    return Response.json({ data: [{ id: "test-model", metadata: { provider: { id: "vendor" } }, supported_endpoints: ["/v1/chat/completions"] }] });
  }
  assert.equal(url, `${GATEWAY}/v1/chat/completions`);
  const request = new Request(input, init);
  assert.equal(request.headers.get("authorization"), "Bearer -");
  const body = await request.json();
  assert.equal(body.model, "vendor/test-model");
  modelRequests++;
  return new Response(`data: ${JSON.stringify({ id: "faux-completion", choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
};

const models = builtinModels();
models.setProvider(createApertureProvider({ baseUrl: GATEWAY, getRegistryModels: () => [...models.getModels()] }));
const result = await models.refresh({ providers: ["aperture"] });
assert.equal(result.errors.size, 0);
const dedicated = models.getModel("aperture", "vendor/test-model");
assert(dedicated);
const native = createProvider({ id: "local", auth: { apiKey: { resolve: async () => undefined } },
  models: [{ ...dedicated, id: "test-model", provider: "local", baseUrl: "https://upstream.example/v1" }], api: openAICompletionsApi() });
models.setProvider(native);
const proxy = createApertureProxy({ baseUrl: GATEWAY, providers: [{ id: "local", gatewayId: "vendor" }],
  getProvider: (id) => models.getProvider(id), registerProvider: (provider) => models.setProvider(provider) });
assert.equal((await proxy.sync()).aborted, false);
const proxied = models.getModel("local", "test-model");
assert(proxied);

for (const model of [dedicated, proxied]) {
  const context = BACKGROUND_CONTEXT;
  const harness = await Harness.open(new MemoryStorage(), { models, registry: createRegistry() }, context);
  try {
    const conversation = await harness.root(context, { agent: { model: { provider: model.provider, modelId: model.id } } });
    const submission = await conversation.submit({ type: "input", content: "Test" }, context);
    const settled = await submission.wait(context);
    assert.equal(settled.status, "done", JSON.stringify(settled));
    const answer = await conversation.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
    assert.equal(answer.model[0].model, model.id);
    assert.equal(answer.model[0].content[0].text, "OK");
  } finally {
    await harness.close(context);
  }
}
assert.equal(modelRequests, 2);
proxy.restore();
assert.equal(models.getProvider("local"), native);
console.log("Packaged /provider and /proxy imports and durable model requests passed");
