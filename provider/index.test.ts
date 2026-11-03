import type {
  AnyModel,
  Api,
  ModelsStoreEntry,
  Provider,
  ProviderHeaders,
  ProviderModelsStore,
  ProviderStreams,
  RefreshModelsContext,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { getModelType } from "@earendil-works/pi-ai";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ApertureProvider } from "../src/api/types";
import type { ModelsDevCatalog } from "../src/model-metadata";
import { DEDICATED_PROVIDER_ID } from "../src/provider/dedicated";
import type { ProvenanceOptions } from "./headers";
import createApertureProvider, {
  DEFAULT_ATTRIBUTION_URL,
  provenanceRequestHeaders,
  SESSION_ID_HEADER,
  withProvenanceHeaders,
} from "./index";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  providers: vi.fn<(signal?: AbortSignal) => Promise<ApertureProvider[]>>(),
  fetchModelsDevCatalog: vi.fn<() => Promise<ModelsDevCatalog | null>>(
    async () => null,
  ),
}));

vi.mock("../src/api/client", () => ({
  ApertureClient: mocks.client,
}));

vi.mock("../src/model-metadata", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/model-metadata")>();
  return {
    ...original,
    fetchModelsDevCatalog: mocks.fetchModelsDevCatalog,
  };
});

const clientMock = vi.mocked(mocks.client);
const providersMock = vi.mocked(mocks.providers);
const fetchModelsDevCatalogMock = vi.mocked(mocks.fetchModelsDevCatalog);

const GATEWAY = "https://ai.pango-lin.ts.net";

function chatModel(id: string, api: Api, baseUrl: string, name = id): AnyModel {
  return {
    provider: DEDICATED_PROVIDER_ID,
    id,
    api,
    baseUrl,
    name,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function gatewayProvider(
  id: string,
  models: string[],
  compatibility: ApertureProvider["compatibility"] = { openai_chat: true },
): ApertureProvider {
  return { id, name: id, models, compatibility, modelInfoById: {} };
}

async function refreshWithStore(
  provider: Provider,
  store: ProviderModelsStore & { entry?: ModelsStoreEntry },
  allowNetwork: boolean,
): Promise<readonly AnyModel[]> {
  if (!provider.refreshModels) throw new Error("no refreshModels");
  const context: RefreshModelsContext = {
    allowNetwork,
    signal: new AbortController().signal,
    get stored() {
      return store.entry;
    },
    publish: async (publication) => {
      if (publication.persist) await store.write(publication.persist);
      publication.update?.();
      return true;
    },
  };
  await provider.refreshModels(context);
  return provider.getAllModels?.() ?? provider.getModels();
}

beforeEach(() => {
  // biome-ignore lint/complexity/useArrowFunction: must be constructible (new ApertureClient)
  clientMock.mockImplementation(function () {
    return { providers: providersMock };
  });
  providersMock.mockReset();
  fetchModelsDevCatalogMock.mockReset();
  fetchModelsDevCatalogMock.mockResolvedValue(null);
});

describe("createApertureProvider", () => {
  test("builds the aperture provider against the normalized gateway URL", () => {
    const provider = createApertureProvider({ baseUrl: "ai.pango-lin.ts.net" });
    expect(provider.id).toBe("aperture");
    expect(provider.name).toBe("Aperture");
    expect(provider.baseUrl).toBe("http://ai.pango-lin.ts.net/v1");
  });

  test("keeps explicit https URLs without rewriting", () => {
    const provider = createApertureProvider({ baseUrl: `${GATEWAY}/v1` });
    expect(provider.baseUrl).toBe(`${GATEWAY}/v1`);
  });

  test.each(["", "   "])("rejects empty baseUrl %j", (baseUrl) => {
    expect(() => createApertureProvider({ baseUrl })).toThrow(
      "Aperture provider requires a gateway baseUrl",
    );
  });

  test("owns gateway auth: always configured, placeholder api key", async () => {
    const provider = createApertureProvider({ baseUrl: GATEWAY });
    const check = await provider.auth.apiKey.check({
      credential: undefined,
    } as never);
    expect(check).toEqual({ type: "api_key", source: "aperture gateway" });
    const resolved = await provider.auth.apiKey.resolve({} as never);
    expect(resolved).toEqual({
      auth: { apiKey: "-" },
      source: "aperture gateway",
    });
  });

  test("stamps Referer provenance on the provider by default", () => {
    const provider = createApertureProvider({ baseUrl: GATEWAY });
    expect(provider.headers).toEqual({ Referer: DEFAULT_ATTRIBUTION_URL });
  });

  test("drops provenance headers when disabled and honors a referer override", () => {
    const disabled = createApertureProvider({
      baseUrl: GATEWAY,
      provenance: { enabled: false },
    });
    expect(disabled.headers).toBeUndefined();

    const override = createApertureProvider({
      baseUrl: GATEWAY,
      provenance: { referer: "https://host.example/app" },
    });
    expect(override.headers).toEqual({ Referer: "https://host.example/app" });
  });

  test("throws for a model api the entry does not dispatch", () => {
    const provider = createApertureProvider({ baseUrl: GATEWAY });
    const model = chatModel(
      "prov/model",
      "mistral-conversations" as Api,
      `${GATEWAY}/v1`,
    ) as never as Parameters<Provider["stream"]>[0];
    const context = { messages: [] } as unknown as TranscriptContext;
    expect(() => provider.stream(model, context)).toThrow(
      "Unsupported Aperture provider API",
    );
  });

  test("fetches and adopts the gateway catalog, persisting the catalog key", async () => {
    providersMock.mockResolvedValue([gatewayProvider("prov", ["model"])]);
    const provider = createApertureProvider({ baseUrl: GATEWAY });
    const store: ProviderModelsStore & { entry?: ModelsStoreEntry } = {
      read: async () => store.entry,
      write: async (entry) => {
        store.entry = entry;
      },
      delete: async () => {
        store.entry = undefined;
      },
    };

    const models = await refreshWithStore(provider, store, true);

    expect(models).toEqual([
      chatModel("prov/model", "openai-completions", `${GATEWAY}/v1`, "model"),
    ]);
    expect(store.entry?.catalogKey).toBe(`${GATEWAY} * v3`);
    expect(store.entry?.models).toEqual(models);
  });

  test("restores a cache-only refresh from a stored catalog", async () => {
    const provider = createApertureProvider({ baseUrl: GATEWAY });
    const stored: ModelsStoreEntry = {
      checkedAt: Date.now(),
      catalogKey: `${GATEWAY} * v3`,
      models: [chatModel("prov/model", "openai-completions", `${GATEWAY}/v1`)],
    };

    const models = await refreshWithStore(
      provider,
      {
        read: async () => stored,
        write: async () => undefined,
        delete: async () => undefined,
        entry: stored,
      },
      false,
    );

    expect(models).toEqual([
      chatModel("prov/model", "openai-completions", `${GATEWAY}/v1`),
    ]);
  });

  test("merges a host catalog so gateway models inherit its metadata", async () => {
    providersMock.mockResolvedValue([gatewayProvider("prov", ["model"])]);
    const provider = createApertureProvider({
      baseUrl: GATEWAY,
      registryModels: () => [
        {
          provider: "prov",
          id: "model",
          name: "Registry Name",
          api: "openai-completions",
          baseUrl: "https://api.openai.com/v1",
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 999_000,
          maxTokens: 4_096,
        },
      ],
    });

    const models = await refreshWithStore(
      provider,
      {
        read: async () => undefined,
        write: async () => undefined,
        delete: async () => undefined,
      },
      true,
    );

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      id: "prov/model",
      name: "Registry Name",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 999_000,
      maxTokens: 4_096,
      baseUrl: `${GATEWAY}/v1`,
    });
  });

  test("filters gateway providers and applies api overrides via providers", async () => {
    providersMock.mockResolvedValue([
      {
        ...gatewayProvider("prov", ["model"]),
        compatibility: { openai_chat: true, openai_responses: true },
      },
      gatewayProvider("other", ["model2"]),
    ]);
    const provider = createApertureProvider({
      baseUrl: GATEWAY,
      providers: [{ id: "prov", enabled: true, api: "openai-responses" }],
    });

    const models = await refreshWithStore(
      provider,
      {
        read: async () => undefined,
        write: async () => undefined,
        delete: async () => undefined,
      },
      true,
    );

    expect(models).toEqual([
      chatModel("prov/model", "openai-responses", `${GATEWAY}/v1`, "model"),
    ]);
  });

  test("keeps classifiers out of getModels but in getAllModels", async () => {
    providersMock.mockResolvedValue([
      {
        ...gatewayProvider("prov", ["text-model", "score-model"]),
        modelInfoById: {
          "score-model": { id: "score-model", system_one: true },
        },
      },
    ]);
    const provider = createApertureProvider({ baseUrl: GATEWAY });
    await refreshWithStore(
      provider,
      {
        read: async () => undefined,
        write: async () => undefined,
        delete: async () => undefined,
      },
      true,
    );

    const all = provider.getAllModels?.() ?? [];
    expect(all.map((m) => getModelType(m))).toEqual(["chat", "classifier"]);
    expect(provider.getModels().map((m) => m.id)).toEqual(["prov/text-model"]);
    expect(provider.classify).toBeDefined();
    expect(() =>
      provider.classify?.({ api: "openai-completions" } as never, {} as never),
    ).toThrow("no classifier implementation");
  });
});

describe("provenanceRequestHeaders", () => {
  test.each([
    [undefined, { Referer: DEFAULT_ATTRIBUTION_URL }],
    [{}, { Referer: DEFAULT_ATTRIBUTION_URL }],
    [
      { referer: "https://host.example/app" },
      { Referer: "https://host.example/app" },
    ],
    [{ enabled: false }, undefined],
  ] as const)("provenanceRequestHeaders(%j)", (options, expected) => {
    expect(provenanceRequestHeaders(options as ProvenanceOptions)).toEqual(
      expected,
    );
  });
});

describe("withProvenanceHeaders", () => {
  function fakeStreams() {
    const calls: Array<ProviderHeaders | undefined> = [];
    const streams: ProviderStreams = {
      stream: (_model, _context, options) => {
        calls.push(options?.headers);
        return undefined as never;
      },
      streamSimple: (_model, _context, options) => {
        calls.push(options?.headers);
        return undefined as never;
      },
    };
    return { streams, calls };
  }

  test("passes streams through when headers are undefined", () => {
    const { streams } = fakeStreams();
    expect(withProvenanceHeaders(streams, undefined)).toBe(streams);
  });

  test("injects the session id per request and lets caller headers win", () => {
    const { streams, calls } = fakeStreams();
    const wrapped = withProvenanceHeaders(streams, {
      Referer: DEFAULT_ATTRIBUTION_URL,
    });
    const context = { messages: [] } as unknown as TranscriptContext;

    wrapped.stream({} as never, context, { sessionId: "s-1" });
    expect(calls[0]).toEqual({
      Referer: DEFAULT_ATTRIBUTION_URL,
      [SESSION_ID_HEADER]: "s-1",
    });

    wrapped.streamSimple({} as never, context, {
      sessionId: "s-2",
      headers: { Referer: "https://host.example/app" },
    });
    expect(calls[1]).toEqual({
      Referer: "https://host.example/app",
      [SESSION_ID_HEADER]: "s-2",
    });

    wrapped.stream({} as never, context);
    expect(calls[2]).toEqual({ Referer: DEFAULT_ATTRIBUTION_URL });
  });
});
