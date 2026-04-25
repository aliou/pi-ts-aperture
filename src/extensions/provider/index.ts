import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { configLoader } from "../../lib/config";
import { onConfigSync } from "../../lib/sync-bus";
import { resolveGatewayUrl, resolveProviderBaseUrl } from "../../lib/url";
import { ApertureProviderRuntime } from "./runtime";

export default async function (pi: ExtensionAPI): Promise<void> {
  await configLoader.load();

  const runtime = new ApertureProviderRuntime();
  let latestCtx: ExtensionContext | null = null;

  const sync = (ctx: ExtensionContext): void => {
    const config = configLoader.getConfig();
    const gatewayUrl = resolveGatewayUrl(config);
    const baseUrl = resolveProviderBaseUrl(config);

    if (!config.apertureProvider || !gatewayUrl || !baseUrl) {
      runtime.unregister(pi);
      return;
    }

    void runtime.sync({
      registerProvider: pi.registerProvider.bind(pi),
      getModels: () => ctx.modelRegistry.getAll(),
      gatewayUrl,
      baseUrl,
    });
  };

  onConfigSync(() => {
    if (latestCtx) sync(latestCtx);
  });

  pi.on("session_start", (_event, ctx) => {
    latestCtx = ctx;
    sync(ctx);
  });
}
