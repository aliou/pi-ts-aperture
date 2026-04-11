import { describe, expect, it } from "vitest";
import type { ApertureConfig } from "./types";
import {
  normalizeInputUrl,
  resolveGatewayUrl,
  resolveProviderBaseUrl,
} from "./url";

const base = (overrides: Partial<ApertureConfig>): ApertureConfig => ({
  mode: "override",
  baseUrl: "",
  providers: [],
  checkGatewayModels: [],
  ...overrides,
});

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
    expect(resolveGatewayUrl(base({ providers: ["openai"] }))).toBeNull();
  });

  it("returns URL even when providers list is empty (provider mode)", () => {
    expect(
      resolveGatewayUrl(
        base({ mode: "provider", baseUrl: "https://example.com" }),
      ),
    ).toBe("https://example.com");
  });

  it("returns URL without trailing slash", () => {
    expect(
      resolveGatewayUrl(
        base({ baseUrl: "https://example.com/", providers: ["openai"] }),
      ),
    ).toBe("https://example.com");
  });

  it("returns URL as-is when no trailing slash", () => {
    expect(
      resolveGatewayUrl(
        base({ baseUrl: "https://example.com", providers: ["openai"] }),
      ),
    ).toBe("https://example.com");
  });

  it("strips multiple trailing slashes", () => {
    expect(
      resolveGatewayUrl(
        base({ baseUrl: "https://example.com///", providers: ["openai"] }),
      ),
    ).toBe("https://example.com");
  });
});

describe("resolveProviderBaseUrl", () => {
  it("returns null when gateway URL cannot be resolved", () => {
    expect(resolveProviderBaseUrl(base({ providers: ["openai"] }))).toBeNull();
  });

  it("appends /v1 to gateway URL", () => {
    expect(
      resolveProviderBaseUrl(
        base({ baseUrl: "https://example.com", providers: ["openai"] }),
      ),
    ).toBe("https://example.com/v1");
  });

  it("handles trailing slashes correctly", () => {
    expect(
      resolveProviderBaseUrl(
        base({ baseUrl: "https://example.com/", providers: ["openai"] }),
      ),
    ).toBe("https://example.com/v1");
  });
});
