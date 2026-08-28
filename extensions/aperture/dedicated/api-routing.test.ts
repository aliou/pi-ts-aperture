import type { Api, Model } from "@earendil-works/pi-ai";
import {
  registerApiProvider,
  unregisterApiProviders,
} from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Context } from "../../shared/types";
import { buildStream, buildStreamSimple } from "./api-routing";

const SOURCE_ID = "dedicated-api-routing-test";

function model(id: string, api: Api): Model<Api> {
  return { provider: "aperture", id, api } as Model<Api>;
}

function fakeApiProvider(api: Api) {
  const provider = {
    api,
    stream: vi.fn().mockReturnValue("stream-result"),
    streamSimple: vi.fn().mockReturnValue("stream-simple-result"),
  };
  registerApiProvider(provider, SOURCE_ID);
  return provider;
}

afterEach(() => {
  unregisterApiProviders(SOURCE_ID);
});

// Path-embedding APIs (Gemini/Vertex/Bedrock) build the request URL from the
// model id, and the gateway forwards those paths verbatim upstream, so the
// provider-qualified catalog id 404s there. These tests dispatch through
// buildStream/buildStreamSimple into a registered fake API provider and
// assert the model object handed downstream — the exact id the adapter then
// puts in the URL or body.
describe("dedicated stream dispatch", () => {
  test("hands the bare id to Gemini/Vertex/Bedrock APIs", () => {
    const gemini = fakeApiProvider("google-generative-ai");
    const vertex = fakeApiProvider("google-vertex");
    const bedrock = fakeApiProvider("bedrock-converse-stream");
    const context = {} as Context;

    expect(
      buildStreamSimple()(
        model("acme/gemini-3.5-flash", "google-generative-ai"),
        context,
      ),
    ).toBe("stream-simple-result");
    expect(gemini.streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "gemini-3.5-flash",
    });

    buildStream()(model("acme/gemini-2.5-pro", "google-vertex"), context);
    expect(vertex.stream.mock.calls[0]?.[0]).toMatchObject({
      id: "gemini-2.5-pro",
    });

    buildStream()(
      model("acme/anthropic.claude-sonnet-4-5", "bedrock-converse-stream"),
      context,
    );
    expect(bedrock.stream.mock.calls[0]?.[0]).toMatchObject({
      id: "anthropic.claude-sonnet-4-5",
    });
  });

  test("strips only the first segment when the upstream id contains slashes", () => {
    const gemini = fakeApiProvider("google-generative-ai");

    buildStreamSimple()(
      model("acme/hf:org/some-model", "google-generative-ai"),
      {} as Context,
    );
    expect(gemini.streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "hf:org/some-model",
    });
  });

  test("keeps qualified ids for body-carried model APIs", () => {
    const completions = fakeApiProvider("openai-completions");
    const responses = fakeApiProvider("openai-responses");
    const anthropic = fakeApiProvider("anthropic-messages");
    const context = {} as Context;

    buildStreamSimple()(
      model("acme/text-model-1", "openai-completions"),
      context,
    );
    expect(completions.streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "acme/text-model-1",
    });

    buildStream()(model("acme/response-model-1", "openai-responses"), context);
    expect(responses.stream.mock.calls[0]?.[0]).toMatchObject({
      id: "acme/response-model-1",
    });

    buildStream()(model("acme/claude-opus-5", "anthropic-messages"), context);
    expect(anthropic.stream.mock.calls[0]?.[0]).toMatchObject({
      id: "acme/claude-opus-5",
    });
  });

  test("leaves already-bare ids untouched", () => {
    const gemini = fakeApiProvider("google-generative-ai");

    buildStreamSimple()(
      model("gemini-3.5-flash", "google-generative-ai"),
      {} as Context,
    );
    expect(gemini.streamSimple.mock.calls[0]?.[0]).toMatchObject({
      id: "gemini-3.5-flash",
    });
  });
});
