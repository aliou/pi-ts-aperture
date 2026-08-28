import { Value } from "typebox/value";
import { describe, expect, test } from "vitest";
import { getSelectableApis } from "../extensions/shared/api-selection";
import { ApertureClient } from "../src/api/client";
import { ApertureProviderSchema } from "../src/api/types";
import { getBaseUrlForApi } from "../src/base-url-routing";
import { GATEWAY, isAccessible } from "./helpers";

const accessible = await isAccessible(GATEWAY);

describe.skipIf(!accessible)("Aperture gateway e2e", () => {
  const client = new ApertureClient(GATEWAY);

  test("providers() returns schema-valid, enabled-only providers", async () => {
    const providers = await client.providers();

    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(Value.Check(ApertureProviderSchema, p)).toBe(true);
    }

    const modelsRes = await fetch(`${GATEWAY}/v1/models`);
    const modelsBodyRaw = await modelsRes.json();
    const modelsBody = modelsBodyRaw as { data: { id: string }[] };
    const enabled = new Set(modelsBody.data.map((m) => m.id));
    for (const provider of providers) {
      for (const id of provider.models) {
        expect(enabled.has(id)).toBe(true);
      }
    }
  });

  test("every enabled provider maps to at least one selectable Pi api", async () => {
    const providers = await client.providers();

    for (const provider of providers) {
      const apis = getSelectableApis(provider.compatibility);
      expect(
        apis.length,
        `provider ${provider.id} compatibility ${JSON.stringify(provider.compatibility)} maps to no Pi api`,
      ).toBeGreaterThan(0);
    }
  });

  test("per-api gateway base URLs resolve under the gateway origin", async () => {
    const providers = await client.providers();

    for (const provider of providers) {
      const api = getSelectableApis(provider.compatibility)[0];
      const baseUrl = getBaseUrlForApi(
        api,
        GATEWAY,
        `${GATEWAY}/v1`,
        undefined,
      );
      const parsed = new URL(baseUrl);
      expect(parsed.origin).toBe(GATEWAY);

      switch (api) {
        case "anthropic-messages":
          expect(parsed.pathname).toBe("");
          break;
        case "google-generative-ai":
          expect(parsed.pathname).toBe("/v1beta");
          break;
        case "google-vertex":
          expect(parsed.pathname).toBe("/v1");
          break;
        case "bedrock-converse-stream":
          expect(parsed.pathname).toBe("/bedrock");
          break;
        default:
          expect(parsed.pathname).toBe("/v1");
      }
    }
  });

  test("chat completions accepts provider-qualified ids with the extension's headers", async () => {
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer -",
        Referer: "https://pi.dev",
        "x-session-id": "pi-aperture-e2e",
      },
      body: JSON.stringify({
        model: "synthetic/syn:small:text",
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 256,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    expect(res.status).toBe(200);
    const bodyRaw = await res.json();
    const body = bodyRaw as {
      choices?: { message?: { content?: unknown } }[];
      usage?: unknown;
    };
    expect(body.choices?.length ?? 0).toBeGreaterThan(0);
    expect(body.usage).toBeDefined();
  });

  test("chat completions streams SSE chunks", async () => {
    const res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "synthetic/syn:small:text",
        messages: [{ role: "user", content: "Reply with exactly: OK" }],
        max_tokens: 256,
        stream: true,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.includes("text/event-stream")).toBe(
      true,
    );

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const decoder = new TextDecoder();
    let received = "";
    while (!received.includes("data:") && received.length < 8192) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
    }
    reader.cancel().catch(() => undefined);
    expect(received).toContain("data:");
  });

  test("gemini generateContent accepts the bare model id in the URL path", async () => {
    const res = await fetch(
      `${GATEWAY}/v1beta/models/${"gemini-3.1-flash-lite"}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with exactly: OK" }] }],
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );

    expect(res.status).toBe(200);
    const bodyRaw = await res.json();
    const body = bodyRaw as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    expect(body.candidates?.length ?? 0).toBeGreaterThan(0);
  });
});
