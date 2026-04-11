/**
 * Parser tests for the Aperture /v1/models response.
 *
 * Uses the real gateway response captured in tests/fixtures/aperture-models.json
 * (shared by the maintainer) so regressions in the wire format are caught.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseGatewayModelsResponse } from "./health";

const fixturePath = join(
  process.cwd(),
  "tests",
  "fixtures",
  "aperture-models.json",
);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("parseGatewayModelsResponse (aperture fixture)", () => {
  const models = parseGatewayModelsResponse(fixture);

  it("parses every entry in the fixture", () => {
    expect(models.length).toBe(fixture.data.length);
  });

  it("preserves ids verbatim (including namespaces and hf: prefix)", () => {
    const ids = models.map((m) => m.id);
    expect(ids).toContain("anthropic/claude-haiku-4.5");
    expect(ids).toContain("openai/gpt-5.2");
    expect(ids).toContain("hf:openai/gpt-oss-120b");
  });

  it("converts per-token pricing to per-million", () => {
    const haiku = models.find((m) => m.id === "anthropic/claude-haiku-4.5");
    expect(haiku?.cost?.input).toBeCloseTo(1.0, 6);
    expect(haiku?.cost?.output).toBeCloseTo(5.0, 6);
    expect(haiku?.cost?.cacheRead).toBeCloseTo(0.1, 6);
    expect(haiku?.cost?.cacheWrite).toBeCloseTo(1.25, 6);
  });

  it("handles models with partial pricing (no cache fields)", () => {
    const deepseek = models.find((m) => m.id === "deepseek/deepseek-v3.2");
    expect(deepseek?.cost?.input).toBeCloseTo(0.26, 6);
    expect(deepseek?.cost?.output).toBeCloseTo(0.38, 6);
    expect(deepseek?.cost?.cacheRead).toBeCloseTo(0.13, 6);
    expect(deepseek?.cost?.cacheWrite).toBeUndefined();
  });

  it("drops wire-only pricing fields (image, web_search, internal_reasoning)", () => {
    // Pi's `Model<TApi>.cost` type is strictly
    // `{ input, output, cacheRead, cacheWrite }` and `calculateCost` only
    // sums those four dimensions (see
    // `@mariozechner/pi-ai/dist/types.d.ts:282` and `models.js:26`), so
    // image / web_search / internal_reasoning have nowhere to live.
    const gemini = models.find((m) => m.id === "google/gemini-2.0-flash-001");
    expect(gemini?.cost).toBeDefined();
    const costKeys = Object.keys(
      gemini?.cost ?? ({} as Record<string, unknown>),
    );
    expect(costKeys.sort()).toEqual(
      ["cacheRead", "cacheWrite", "input", "output"].sort(),
    );
  });

  it("leaves cost undefined when the gateway emits no pricing block", () => {
    const bare = models.find((m) => m.id === "hf:openai/gpt-oss-120b");
    expect(bare).toBeDefined();
    expect(bare?.cost).toBeUndefined();
  });

  it("leaves contextWindow / maxTokens / input / reasoning unset", () => {
    for (const m of models) {
      expect(m.contextWindow).toBeUndefined();
      expect(m.maxTokens).toBeUndefined();
      expect(m.input).toBeUndefined();
      expect(m.reasoning).toBeUndefined();
    }
  });

  it("does not emit a name when the gateway emits none", () => {
    for (const m of models) {
      expect(m.name).toBeUndefined();
    }
  });
});

describe("parseGatewayModelsResponse (defensive)", () => {
  it("returns [] for a non-object body", () => {
    expect(parseGatewayModelsResponse(null)).toEqual([]);
    expect(parseGatewayModelsResponse("nope")).toEqual([]);
    expect(parseGatewayModelsResponse(42)).toEqual([]);
  });

  it("returns [] when data is not an array", () => {
    expect(parseGatewayModelsResponse({})).toEqual([]);
    expect(parseGatewayModelsResponse({ data: "nope" })).toEqual([]);
  });

  it("skips entries without a string id", () => {
    const parsed = parseGatewayModelsResponse({
      data: [{ id: "ok" }, { foo: "bar" }, { id: 42 }],
    });
    expect(parsed.map((m) => m.id)).toEqual(["ok"]);
  });

  it("accepts numeric pricing values and converts them", () => {
    const parsed = parseGatewayModelsResponse({
      data: [{ id: "x", pricing: { input: 0.000002, output: 0.000008 } }],
    });
    expect(parsed[0].cost?.input).toBeCloseTo(2.0, 6);
    expect(parsed[0].cost?.output).toBeCloseTo(8.0, 6);
  });

  it("ignores non-numeric pricing strings", () => {
    const parsed = parseGatewayModelsResponse({
      data: [{ id: "x", pricing: { input: "abc", output: "0.00000100" } }],
    });
    expect(parsed[0].cost?.input).toBeUndefined();
    expect(parsed[0].cost?.output).toBeCloseTo(1.0, 6);
  });

  it("tolerates display_name as a name fallback", () => {
    const parsed = parseGatewayModelsResponse({
      data: [{ id: "x", display_name: "Mr. X" }],
    });
    expect(parsed[0].name).toBe("Mr. X");
  });

  it("tolerates alternate context/max keys", () => {
    const parsed = parseGatewayModelsResponse({
      data: [
        {
          id: "x",
          context_window: 128000,
          max_output_tokens: 16384,
          input_modalities: ["text"],
        },
      ],
    });
    expect(parsed[0].contextWindow).toBe(128000);
    expect(parsed[0].maxTokens).toBe(16384);
    expect(parsed[0].input).toEqual(["text"]);
  });
});
