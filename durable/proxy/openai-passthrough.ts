// Pi uses this exact URL to detect ChatGPT subscription credentials. Keep it
// visible to the adapter and redirect the HTTP request after it builds the body.
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export function withOpenAIGatewayFetch<
  T extends { fetch?: typeof globalThis.fetch },
>(options: T | undefined, gatewayRoot: string | undefined): T | undefined {
  if (!gatewayRoot) return options;
  return Object.assign({}, options, {
    fetch: createOpenAIGatewayFetch(gatewayRoot, options?.fetch),
  });
}

export function createOpenAIGatewayFetch(
  gatewayRoot: string,
  fetch: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  const gateway = new URL(gatewayRoot);
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.origin !== "https://api.openai.com") return fetch(input, init);
    if (!url.pathname.startsWith("/v1/")) return fetch(input, init);

    url.protocol = gateway.protocol;
    url.host = gateway.host;
    const redirected = input instanceof Request ? new Request(url, input) : url;
    return fetch(redirected, init);
  };
}
