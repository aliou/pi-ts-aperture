import { createApertureProvider } from "@aliou/pi-ts-aperture/provider";
import type { Api, Model } from "@earendil-works/pi-ai";
import { createModels, InMemoryModelsStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const GATEWAY = "http://ai.pango-lin.ts.net";

function gatewayModel(
  provider: string,
  id: string,
  endpoints = ["/v1/chat/completions"],
  requiresClientAuth = false,
) {
  return {
    id,
    metadata: {
      provider: { id: provider, requires_client_auth: requiresClientAuth },
    },
    supported_endpoints: endpoints,
    pricing: { input: "0.000002", output: "0.000003" },
  };
}

function register(modelsStore = new InMemoryModelsStore()) {
  const models = createModels({ modelsStore });
  models.setProvider(createApertureProvider({ baseUrl: GATEWAY }));
  return models;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async (url) => {
    if (String(url) === `${GATEWAY}/v1/models`) {
      return Response.json({
        data: [
          gatewayModel("vendor", "text-model"),
          gatewayModel("subscription", "private-model", undefined, true),
        ],
      });
    }
    if (String(url) === "https://models.dev/api.json") return Response.json({});
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => vi.unstubAllGlobals());

test("public provider refresh makes gateway-managed models selectable without credentials", async () => {
  const models = register();
  expect(models.getModels("aperture")).toEqual([]);

  const result = await models.refresh({ providers: ["aperture"] });

  expect(result.errors.size).toBe(0);
  expect(result.aborted).toBe(false);
  const available = await models.getAvailable("aperture");
  expect(available).toHaveLength(1);
  expect(available[0]).toMatchObject({
    provider: "aperture",
    id: "vendor/text-model",
    api: "openai-completions",
    baseUrl: `${GATEWAY}/v1`,
    contextWindow: 128_000,
    maxTokens: 8_192,
    input: ["text"],
    reasoning: false,
    cost: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0 },
  });
  const auth = await models.getAuth(available[0]);
  expect(auth).toMatchObject({
    auth: { apiKey: "-" },
  });
});

test("refresh reports gateway failures and keeps the persisted catalog", async () => {
  const models = register();
  await models.refresh();
  fetchMock.mockResolvedValue(new Response(null, { status: 503 }));

  const result = await models.refresh({ providers: ["aperture"] });

  expect(result.errors.get("aperture")?.message).toContain("503");
  expect(models.getModels("aperture").map((m) => m.id)).toEqual([
    "vendor/text-model",
  ]);
});

test("a fresh provider restores a stored catalog without network access", async () => {
  const store = new InMemoryModelsStore();
  await register(store).refresh();
  fetchMock.mockClear();
  const restored = register(store);

  const result = await restored.refresh({ allowNetwork: false });

  expect(result.errors.size).toBe(0);
  expect(restored.getModel("aperture", "vendor/text-model")).toBeDefined();
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each([
  { baseUrl: `${GATEWAY}.evil` },
  { baseUrl: GATEWAY, providers: [{ id: "other", enabled: true }] },
  {
    baseUrl: GATEWAY,
    providers: [
      { id: "vendor", enabled: true, api: "anthropic-messages" as const },
    ],
  },
])("cache-only restore rejects a different catalog identity: %j", async (options) => {
  const store = new InMemoryModelsStore();
  await register(store).refresh();
  fetchMock.mockClear();
  const models = createModels({ modelsStore: store });
  models.setProvider(createApertureProvider(options));

  await models.refresh({ allowNetwork: false });

  expect(models.getModels("aperture")).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("filters and API overrides apply while client-auth providers stay excluded", async () => {
  fetchMock.mockImplementation(async (url) => {
    if (String(url).includes("models.dev")) return Response.json({});
    return Response.json({
      data: [
        gatewayModel("vendor", "text-model", [
          "/v1/chat/completions",
          "/v1/messages",
        ]),
        gatewayModel("other", "hidden"),
        gatewayModel("subscription", "private-model", undefined, true),
      ],
    });
  });
  const models = createModels();
  models.setProvider(
    createApertureProvider({
      baseUrl: GATEWAY,
      providers: [
        { id: "vendor", enabled: true, api: "anthropic-messages" },
        { id: "other", enabled: false },
        { id: "subscription", enabled: true },
      ],
    }),
  );

  await models.refresh();

  expect(models.getModels("aperture")).toHaveLength(1);
  expect(models.getModels("aperture")[0]).toMatchObject({
    id: "vendor/text-model",
    api: "anthropic-messages",
    baseUrl: GATEWAY,
  });
});

test("an unsupported API override warns and falls back to auto selection", async () => {
  const onWarning = vi.fn();
  const models = createModels();
  models.setProvider(
    createApertureProvider({
      baseUrl: GATEWAY,
      providers: [{ id: "vendor", enabled: true, api: "google-vertex" }],
      onWarning,
    }),
  );

  await models.refresh();

  expect(models.getModels("aperture")[0]?.api).toBe("openai-completions");
  expect(onWarning).toHaveBeenCalledWith(
    expect.stringContaining("google-vertex"),
  );
});

test("native metadata supplies capabilities and routing while gateway pricing wins", async () => {
  const native: Model<Api> = {
    provider: "vendor",
    id: "text-model",
    api: "openai-completions",
    baseUrl: "https://vendor.example/api/v4",
    name: "Native model",
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    maxTokens: 16_000,
    cost: { input: 9, output: 10, cacheRead: 1, cacheWrite: 2 },
  };
  const models = createModels();
  models.setProvider(
    createApertureProvider({
      baseUrl: GATEWAY,
      getRegistryModels: () => [native, ...models.getModels()],
    }),
  );

  await models.refresh();
  await models.refresh();

  expect(models.getModels("aperture")[0]).toMatchObject({
    name: native.name,
    reasoning: true,
    input: ["text", "image"],
    contextWindow: 200_000,
    baseUrl: GATEWAY,
    cost: { input: 2, output: 3, cacheRead: 1, cacheWrite: 2 },
  });
});

test("cancelling a gateway refresh publishes no partial catalog", async () => {
  const models = register();
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  fetchMock.mockImplementation((_url, options) => {
    started.resolve();
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener(
        "abort",
        () => reject(options.signal?.reason),
        {
          once: true,
        },
      );
    });
  });

  const pending = models.refresh({ signal: controller.signal });
  await started.promise;
  controller.abort();
  const result = await pending;

  expect(result.aborted).toBe(true);
  expect(result.errors.size).toBe(0);
  expect(models.getModels("aperture")).toEqual([]);
});

test("requests route through the gateway with a qualified ID, placeholder key, and host headers", async () => {
  const models = register();
  await models.refresh();
  const model = models.getModel("aperture", "vendor/text-model");
  if (!model) throw new Error("missing refreshed model");
  const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      `data: ${JSON.stringify({
        id: "mock-completion",
        choices: [
          { index: 0, delta: { content: "OK" }, finish_reason: "stop" },
        ],
      })}\n\ndata: [DONE]\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    ),
  );

  const answer = await models.completeSimple(
    model,
    { messages: [{ role: "user", content: "Test", timestamp: 0 }] },
    {
      fetch: requestFetch,
      headers: { "x-session-id": "host-session" },
    },
  );

  expect(answer.stopReason).toBe("stop");
  expect(answer.content).toMatchObject([{ type: "text", text: "OK" }]);
  expect(requestFetch).toHaveBeenCalledOnce();
  const [url, init] = requestFetch.mock.calls[0];
  const request = new Request(url, init);
  expect(request.url).toBe(`${GATEWAY}/v1/chat/completions`);
  expect(request.headers.get("authorization")).toBe("Bearer -");
  expect(request.headers.get("x-session-id")).toBe("host-session");
  expect(request.headers.get("referer")).toBeNull();
  const payload = await request.json();
  expect(payload).toMatchObject({ model: "vendor/text-model" });
});
