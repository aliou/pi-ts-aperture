# Proxy routing

Read this before changing proxy mode (`extensions/aperture/proxy/`) or the dedicated provider (`src/provider/`, `provider/`). These rules are easy to break and hard to see in the code.

## Provider mapping

`proxy.upstreamProviders[].id` names the local Pi provider; it is used to register and unregister. The required `gatewayId` names the gateway catalog target; it is used for compatibility, filtering, passthrough auth, and model-id qualification. Unknown targets stay unrouted, with one warning per sync.

## Model ids

- Request model ids are provider-qualified (`provider/model-id`). Path-embedding APIs (Gemini, Vertex, Bedrock) are the exception: they keep bare ids, because the gateway only accepts bare ids in URL paths.
- `getModels()` keeps bare ids, so the model picker is unaffected.
- Proxy streams rewrite `model` on emitted assistant messages back to the bare id (`proxy/model-id.ts`). Pi restores a resumed session's model from the last assistant message.
- Before dispatch, `withRequestModelId` changes matching assistant messages to use the request id, so pi-ai keeps reasoning and signatures. A message matches only when its local provider, API, and public model id all match. Never mutate session history or relabel turns from other models.

## Gateway URL

- Pi composes the served catalog from `getAllModels()` when it exists and falls back to `getModels()`. The wrapper must rewrite both.
- Auth resolution can rewrite `model.baseUrl` (for example, GitHub Copilot OAuth). Proxy streams therefore set the gateway URL again at dispatch. Without that, gateway-qualified ids reach the upstream vendor and return 404.
- Only chat models get the route's `api`. Classifier models keep their own `api` but get the gateway base URL, so model snapshots must include `getModelsOfType("classifier")`. Image models keep their own `api` and `baseUrl`.
- Every model gets the placeholder auth, because Pi resolves auth per provider.
- Passthrough `openai-responses` routes whose upstream base URL is exactly `https://api.openai.com/v1` keep that URL. Their requests are redirected through `options.fetch` (`proxy/openai-passthrough.ts`), because Pi's ChatGPT sign-in detection needs the native URL.

## Lifecycle ordering

- Register the placeholder-key auth override synchronously, before awaiting the catalog fetch. Otherwise an immediate `/spawn` can race the auth setup.
- On `session_shutdown`, mark the runtime invalidated first, then unregister the tracked proxy providers while Pi's API is still active. `/reload` reuses the model runtime. When settings unregister a route, remove its id from the tracked set.

## Model metadata

Token limits advertised by the gateway's `/v1/models` outrank catalog metadata, because they describe the route rather than the model. Everything else resolves from `~/.pi/agent/models.json`, then the Pi registry, then models.dev. The extension config never persists a model cache.

## Classifiers

A model served only over `/v1/systemone` becomes a classifier. A model served over `/v1/decisions` also gets an `openai-decisions` classifier. Classifiers are emitted only for APIs in the injected `classifierApis`. pi-ai does not export its classifier factories, so the clients are reimplemented in `src/`.
