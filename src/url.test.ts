import { describe, expect, test } from "vitest";
import { normalizeInputUrl } from "./url";

describe("normalizeInputUrl", () => {
  test("adds http:// scheme to bare hostname", () => {
    expect(normalizeInputUrl("ai.tetra-albacore.ts.net")).toBe(
      "http://ai.tetra-albacore.ts.net",
    );
  });

  test("preserves https:// scheme", () => {
    expect(normalizeInputUrl("https://ai.host.ts.net")).toBe(
      "https://ai.host.ts.net",
    );
  });

  test("preserves http:// scheme", () => {
    expect(normalizeInputUrl("http://ai.host.ts.net")).toBe(
      "http://ai.host.ts.net",
    );
  });

  test("strips path from full URL", () => {
    expect(normalizeInputUrl("http://ai.host.ts.net/v1/models")).toBe(
      "http://ai.host.ts.net",
    );
  });

  test("strips /v1 path", () => {
    expect(normalizeInputUrl("http://ai.host.ts.net/v1")).toBe(
      "http://ai.host.ts.net",
    );
  });

  test("strips /v1/ trailing slash", () => {
    expect(normalizeInputUrl("http://ai.host.ts.net/v1/")).toBe(
      "http://ai.host.ts.net",
    );
  });

  test("strips query string", () => {
    expect(normalizeInputUrl("http://ai.host.ts.net/v1?key=abc")).toBe(
      "http://ai.host.ts.net",
    );
  });

  test("strips fragment", () => {
    expect(normalizeInputUrl("http://ai.host.ts.net#section")).toBe(
      "http://ai.host.ts.net",
    );
  });

  test("preserves port", () => {
    expect(normalizeInputUrl("http://ai.host.ts.net:8080/v1")).toBe(
      "http://ai.host.ts.net:8080",
    );
  });

  test("handles https with full URL", () => {
    expect(normalizeInputUrl("https://ai.host.ts.net/v1/models?foo=bar")).toBe(
      "https://ai.host.ts.net",
    );
  });

  test("trims whitespace", () => {
    expect(normalizeInputUrl("  http://ai.host.ts.net/v1  ")).toBe(
      "http://ai.host.ts.net",
    );
  });

  test("returns empty string for empty input", () => {
    expect(normalizeInputUrl("")).toBe("");
  });

  test("returns empty string for whitespace-only input", () => {
    expect(normalizeInputUrl("   ")).toBe("");
  });
});
