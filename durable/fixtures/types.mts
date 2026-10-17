import { createApertureProvider, type ApertureProviderOptions } from "@aliou/pi-ts-aperture/provider";
import { createApertureProxy, type ApertureProxyOptions, type ApertureProxySyncResult } from "@aliou/pi-ts-aperture/proxy";
import { createModels, type Provider } from "@earendil-works/pi-ai";

const models = createModels();
const options: ApertureProviderOptions = { baseUrl: "http://ai.pango-lin.ts.net" };
const provider: Provider = createApertureProvider(options);
models.setProvider(provider);
const routing: ApertureProxyOptions = {
  baseUrl: options.baseUrl, providers: [{ id: "native", gatewayId: "vendor" }],
  getProvider: (id) => models.getProvider(id), registerProvider: (next) => models.setProvider(next),
};
const proxy = createApertureProxy(routing);
const result: ApertureProxySyncResult = await proxy.sync({ signal: new AbortController().signal });
result.catalogError?.message;
proxy.restore();
