import { describe, expect, it } from "vitest";
import {
  errorResponse,
  isJsonRpcMessage,
  isRequest,
  parseErrorResponse,
  successResponse,
} from "./protocol";
import { generateWrapperHtml } from "./wrapper";

describe("mcp-app protocol", () => {
  it("detects valid JSON-RPC messages", () => {
    expect(isJsonRpcMessage({ jsonrpc: "2.0", method: "tools/call" })).toBe(
      true,
    );
    expect(
      isJsonRpcMessage({ jsonrpc: "2.0", method: "tools/call", id: 1 }),
    ).toBe(true);
    expect(isJsonRpcMessage({ method: "tools/call" })).toBe(false);
    expect(isJsonRpcMessage(null)).toBe(false);
  });

  it("distinguishes requests from notifications", () => {
    expect(isRequest({ jsonrpc: "2.0", method: "x", id: 1 })).toBe(true);
    expect(isRequest({ jsonrpc: "2.0", method: "x" })).toBe(false);
  });

  it("builds success responses", () => {
    expect(successResponse(1, { ok: true })).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
  });

  it("builds error responses", () => {
    expect(errorResponse(42, { code: -32600, message: "Bad request" })).toEqual(
      {
        jsonrpc: "2.0",
        id: 42,
        error: { code: -32600, message: "Bad request" },
      },
    );

    expect(parseErrorResponse()).toEqual({
      jsonrpc: "2.0",
      id: undefined,
      error: { code: -32700, message: "Parse error" },
    });
  });
});

describe("mcp-app wrapper", () => {
  it("embeds app HTML and WebSocket URL", () => {
    const html = generateWrapperHtml({
      appHtml: "<h1>Hello</h1>",
      wsUrl: "ws://127.0.0.1:1234/ws?token=abc",
    });
    // '<' is escaped as \u003c so app HTML cannot break the wrapper script tag.
    expect(html).toContain("\\u003ch1>Hello\\u003c/h1>");
    expect(html).toContain("ws://127.0.0.1:1234/ws?token=abc");
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
  });

  it("escapes app HTML so it cannot break the script tag", () => {
    const html = generateWrapperHtml({
      appHtml: "</script><script>alert(1)</script>",
      wsUrl: "",
    });
    expect(html).toContain('iframe.srcdoc = "\\u003c/script>');
    expect(html).not.toContain('iframe.srcdoc = "</script>');
  });

  it("escapes the title", () => {
    const html = generateWrapperHtml({
      appHtml: "",
      wsUrl: "",
      title: "<script>",
    });
    expect(html).toContain("<title>&lt;script&gt;</title>");
    expect(html).not.toContain("<title><script></title>");
  });

  it("defaults the title", () => {
    const html = generateWrapperHtml({ appHtml: "", wsUrl: "" });
    expect(html).toContain("<title>MCP App Host</title>");
  });
});
