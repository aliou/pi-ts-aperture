import { describe, expect, it } from "vitest";
import type { ApertureConfig } from "../../src/core/types";
import {
  normalizeInputUrl,
  resolveGatewayUrl,
  resolveProviderBaseUrl,
} from "../../src/core/url";

describe("normalizeInputUrl", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeInputUrl("")).toBe("");
  });

  it("trims whitespace", () => {
    expect(normalizeInputUrl("  https://example.com  ")).toBe(
      "https://example.com",
    );
  });

  it("adds http:// scheme when missing", () => {
    expect(normalizeInputUrl("example.com")).toBe("http://example.com");
  });

  it("preserves https:// scheme", () => {
    expect(normalizeInputUrl("https://example.com")).toBe(
      "https://example.com",
    );
  });

  it("preserves http:// scheme", () => {
    expect(normalizeInputUrl("http://example.com")).toBe("http://example.com");
  });

  it("strips trailing /v1", () => {
    expect(normalizeInputUrl("https://example.com/v1")).toBe(
      "https://example.com",
    );
  });

  it("strips trailing /v1/", () => {
    expect(normalizeInputUrl("https://example.com/v1/")).toBe(
      "https://example.com",
    );
  });

  it("strips trailing slashes", () => {
    expect(normalizeInputUrl("https://example.com/")).toBe(
      "https://example.com",
    );
  });

  it("strips multiple trailing slashes", () => {
    expect(normalizeInputUrl("https://example.com///")).toBe(
      "https://example.com",
    );
  });

  it("handles already-normalized URL", () => {
    expect(normalizeInputUrl("https://example.com")).toBe(
      "https://example.com",
    );
  });
});

describe("resolveGatewayUrl", () => {
  it("returns null when baseUrl is empty", () => {
    const config: ApertureConfig = { baseUrl: "", providers: ["openai"] };
    expect(resolveGatewayUrl(config)).toBeNull();
  });

  it("returns null when providers is empty", () => {
    const config: ApertureConfig = {
      baseUrl: "https://example.com",
      providers: [],
    };
    expect(resolveGatewayUrl(config)).toBeNull();
  });

  it("returns null when both baseUrl and providers are empty", () => {
    const config: ApertureConfig = { baseUrl: "", providers: [] };
    expect(resolveGatewayUrl(config)).toBeNull();
  });

  it("returns URL without trailing slash", () => {
    const config: ApertureConfig = {
      baseUrl: "https://example.com/",
      providers: ["openai"],
    };
    expect(resolveGatewayUrl(config)).toBe("https://example.com");
  });

  it("returns URL as-is when no trailing slash", () => {
    const config: ApertureConfig = {
      baseUrl: "https://example.com",
      providers: ["openai"],
    };
    expect(resolveGatewayUrl(config)).toBe("https://example.com");
  });

  it("strips multiple trailing slashes", () => {
    const config: ApertureConfig = {
      baseUrl: "https://example.com///",
      providers: ["openai"],
    };
    expect(resolveGatewayUrl(config)).toBe("https://example.com");
  });
});

describe("resolveProviderBaseUrl", () => {
  it("returns null when gateway URL cannot be resolved", () => {
    const config: ApertureConfig = { baseUrl: "", providers: ["openai"] };
    expect(resolveProviderBaseUrl(config)).toBeNull();
  });

  it("appends /v1 to gateway URL", () => {
    const config: ApertureConfig = {
      baseUrl: "https://example.com",
      providers: ["openai"],
    };
    expect(resolveProviderBaseUrl(config)).toBe("https://example.com/v1");
  });

  it("handles trailing slashes correctly", () => {
    const config: ApertureConfig = {
      baseUrl: "https://example.com/",
      providers: ["openai"],
    };
    expect(resolveProviderBaseUrl(config)).toBe("https://example.com/v1");
  });
});
