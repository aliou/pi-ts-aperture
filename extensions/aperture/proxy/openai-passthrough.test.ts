import { describe, expect, test, vi } from "vitest";
import {
  createOpenAIGatewayFetch,
  OPENAI_BASE_URL,
} from "./openai-passthrough";

describe("createOpenAIGatewayFetch", () => {
  const gatewayRoot = "https://ai.pango-lin.ts.net:8443";

  test.each([
    `${OPENAI_BASE_URL}/responses?include=usage`,
    new URL(`${OPENAI_BASE_URL}/responses?include=usage`),
  ])("redirects string and URL inputs without changing request options", async (input) => {
    const fetch = vi.fn().mockResolvedValue(new Response());
    const init = {
      method: "POST",
      body: '{"model":"openai/gpt-6-sol"}',
      headers: { Referer: "https://pi.dev", "x-session-id": "session-1" },
      signal: new AbortController().signal,
    };
    const response = await createOpenAIGatewayFetch(gatewayRoot, fetch)(
      input,
      init,
    );

    expect(fetch).toHaveBeenCalledWith(
      new URL(`${gatewayRoot}/v1/responses?include=usage`),
      init,
    );
    const fetchedResponse = await fetch.mock.results[0].value;
    expect(response).toBe(fetchedResponse);
  });

  test("redirects Request inputs with their body, headers, method, and signal", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response());
    const controller = new AbortController();
    const request = new Request(`${OPENAI_BASE_URL}/responses`, {
      method: "POST",
      body: '{"model":"openai/gpt-6-sol"}',
      headers: { "x-session-id": "session-1" },
      signal: controller.signal,
    });
    const init = { headers: { Referer: "https://pi.dev" } };
    await createOpenAIGatewayFetch(gatewayRoot, fetch)(request, init);

    const [redirected, forwardedInit] = fetch.mock.calls[0];
    expect(redirected).toBeInstanceOf(Request);
    expect(redirected.url).toBe(`${gatewayRoot}/v1/responses`);
    expect(redirected.method).toBe("POST");
    expect(redirected.headers.get("x-session-id")).toBe("session-1");
    const body = await redirected.text();
    expect(body).toBe('{"model":"openai/gpt-6-sol"}');
    expect(forwardedInit).toBe(init);
    controller.abort();
    expect(redirected.signal.aborted).toBe(true);
  });

  test.each([
    "https://api.openai.com/other/responses",
    "https://api.openai.com/v10/responses",
    "https://api.openai.com.evil.test/v1/responses",
    "http://api.openai.com/v1/responses",
    `${gatewayRoot}/v1/responses`,
  ])("leaves unrelated URLs unchanged: %s", async (input) => {
    const fetch = vi.fn().mockResolvedValue(new Response());
    await createOpenAIGatewayFetch(gatewayRoot, fetch)(input);
    expect(fetch).toHaveBeenCalledWith(input, undefined);
  });
});
