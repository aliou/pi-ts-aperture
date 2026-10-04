# Aperture for pi-durable

Experimental integration for pi-durable. Its provider, proxy, API client, routing, and metadata code live in `durable/`. This implementation does not depend on `extensions/` or `src/`.

Use `/provider` for a dedicated gateway catalog or `/proxy` to route existing providers. Both work with pi-ai and pi-durable without coding-agent extensions. The exports contain compiled ESM JavaScript and TypeScript declarations; they need no Pi loader or source resolver. Neither reads extension config or environment overrides.

Install in a Node ESM app (Node 22.19 or later for pi-durable):

```bash
npm install @aliou/pi-ts-aperture @earendil-works/pi-ai @earendil-works/pi-durable @earendil-works/chord
```

```typescript
import { createApertureProvider } from "@aliou/pi-ts-aperture/provider";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

const models = builtinModels();
models.setProvider(createApertureProvider({
  baseUrl: "http://ai.pango-lin.ts.net",
  getRegistryModels: () => [...models.getModels()],
}));

const result = await models.refresh({ providers: ["aperture"] });
if (result.aborted) throw new Error("Aperture catalog refresh cancelled");
const error = result.errors.get("aperture");
if (error) throw error;

const [model] = await models.getAvailable("aperture");
if (!model) throw new Error("No gateway-managed Aperture models available");

const context = BACKGROUND_CONTEXT;
const harness = await Harness.open(
  new MemoryStorage(),
  { models, registry: createRegistry() },
  context,
);
await harness.root(context, {
  agent: { model: { provider: model.provider, modelId: model.id } },
});
await harness.close(context);
```

Select a specific model with `models.getModel("aperture", "gateway-provider/model-id")`. Pass the same `models` collection to `Harness.open()`; no durable-specific adapter is needed. Gateway-managed auth uses the placeholder key `"-"`. Providers requiring client credentials are excluded, even when selected explicitly.

Factory options:

| Option | Default and behavior |
|---|---|
| `baseUrl` | Required gateway URL, with or without `/v1`. No config file or environment variable is read. |
| `providers` | Omitted or `[]` includes all gateway-managed providers. A nonempty list includes only rows with `enabled: true`; each row has `id` and an optional `api` override. |
| `getRegistryModels` | Omitted means no native metadata. Called on each network refresh for capabilities and upstream URL inference. Native metadata wins over best-effort models.dev metadata; gateway pricing wins for each reported cost field. |
| `onWarning` | Optional callback for unsupported API overrides. Routing falls back to the gateway's auto-selected API. |

Supported overrides are `openai-completions`, `anthropic-messages`, `openai-responses`, `google-generative-ai`, `google-vertex`, and `bedrock-converse-stream`. Without metadata, models use text input, no reasoning, a 128,000-token context window, and an 8,192-token output limit. Unreported costs default to zero.

### Proxy existing providers

```typescript
import { createApertureProxy } from "@aliou/pi-ts-aperture/proxy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

const models = builtinModels();
const proxy = createApertureProxy({
  baseUrl: "http://ai.pango-lin.ts.net",
  providers: [{ id: "openai", gatewayId: "gateway-openai" }],
  getProvider: (id) => models.getProvider(id),
  registerProvider: (provider) => models.setProvider(provider),
  onWarning: console.warn,
});

const result = await proxy.sync();
if (result.aborted) throw new Error("Aperture proxy setup cancelled");
const model = models.getModel("openai", "gpt-4o");
if (!model) throw new Error("Local model not available");
// Pass these models to Harness.open(), or use pi-ai request methods.
proxy.restore();
```

Each route names a local provider in `id` and a gateway provider in `gatewayId`. Local model and provider IDs stay unchanged. Requests use gateway-qualified IDs except for APIs that put the ID in a URL path. Matching assistant turns are copied for replay; stored transcripts are not mutated.

Route options:

| Option | Default and behavior |
|---|---|
| `enabled` | Defaults to `true`. Disabled or removed routes are restored on sync. An empty list routes nothing. |
| `api` | Optional chat API override, validated against gateway compatibility. Unsupported overrides warn and retain the native API. |
| `keepGatewayModelsOnly` | Defaults to `false`. Filters chat, image, and classifier catalogs to gateway-served IDs. |
| `shouldCheckGatewayModels` | Defaults to `false`. Warns about local chat models missing from the gateway. |

`await proxy.sync({ baseUrl, providers, signal })` changes routing; omitted fields retain their current values. Await setup before starting requests. API-key providers receive provisional placeholder auth synchronously, before the catalog fetch finishes. Gateway-managed routes use `"-"`; passthrough routes keep native auth. OAuth-only providers wait for the catalog before being wrapped. Catalog failure returns `catalogError` and keeps routing fail-open without filtering or applying unverified overrides.

Overlapping syncs use the latest call. Cancellation stops pending catalog work but leaves provisional wrappers installed. A pre-aborted signal leaves routing unchanged. `restore()` cancels pending work and restores only providers still owned by this controller. It leaves unrelated replacements alone. A later explicit sync can wrap those replacements. Use one controller per provider set and restore it when the host closes.

Wrappers read live native catalogs and preserve native refresh and filter operations. Image generation and classification keep their own APIs. Deferred fetch and cancellation copy request handles, retain public result IDs, and reject a chat API override that cannot use the native deferred transport. OpenAI subscription passthrough keeps the native OpenAI URL for subscription request rules and redirects fetch to the gateway. Other routes enforce gateway URLs again at dispatch, after native auth resolution.

The proxy creates no model catalog store. Persistence remains the native provider's responsibility. Pass the same `models` collection to `Harness.open()` without an adapter.

### Catalog persistence

pi-ai defaults to an in-memory `ModelsStore`. **Durable session storage does not persist the provider catalog.** For offline startup across processes, supply your own persistent `ModelsStore` through `builtinModels({ modelsStore })` or `createModels({ modelsStore })`. Store the complete entry, including Aperture's `catalogKey`, and honor abort signals on store operations.

Call `models.refresh({ providers: ["aperture"], allowNetwork: false })` to restore without network access. Restore accepts only a matching gateway origin, provider filter, and API overrides. Network refresh publishes the catalog through `context.publish`; failures appear in `result.errors` and retain a matching cached catalog. Without a persistent store, refresh the gateway before resuming a session that selects an Aperture model.

### Request headers

Neither public API adds session-specific provenance headers. The host can pass `headers` or `transformHeaders` to pi-ai request methods such as `models.completeSimple()`:

```typescript
await models.completeSimple(model, { messages }, {
  headers: { "x-session-id": sessionId, Referer: appUrl },
});
```

For harness-owned requests, a host-side wrapper around the provider's `stream` and `streamSimple` methods can merge current headers into request options. Compute session values per request rather than attaching them to the factory.

## Development

From the repository root, run `pnpm build` to emit ESM and declarations in `durable/dist/`. Run `pnpm test` for extension, gateway, and durable tests, including directory-boundary checks. `pnpm test:package` installs the packed exports in a temporary app and checks Node imports, NodeNext declarations, mocked durable requests, and Pi extension loading. It downloads npm dependencies but makes no paid calls.
