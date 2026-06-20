/**
 * MCP Streamable HTTP client for Aperture connectors.
 *
 * Manages session initialization, capability discovery, and tool calls
 * through Aperture's /v1/mcp endpoint using the 2024-11-05 protocol.
 */

const MCP_VERSION = "2024-11-05";
const INIT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 60_000;

let nextId = 2; // 1 is used by initialize

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  _meta?: unknown;
}

export interface McpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface McpReadResourceResult {
  contents: McpResourceContent[];
}

export interface McpContentItem {
  type: string;
  text?: string;
}

export interface McpCallResult {
  content: McpContentItem[];
  isError?: boolean;
  structuredContent?: unknown;
  [key: string]: unknown;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
  id?: number;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpInitializeResult {
  capabilities: unknown;
  protocolVersion: string;
  serverInfo: { name: string; version: string };
}

export interface McpSession {
  listTools(signal?: AbortSignal): Promise<McpTool[]>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<McpCallResult>;
  listResourceTemplates(signal?: AbortSignal): Promise<McpResourceTemplate[]>;
  listResources(signal?: AbortSignal): Promise<McpResource[]>;
  readResource(
    uri: string,
    signal?: AbortSignal,
  ): Promise<McpReadResourceResult>;
  close(): void;
}

function buildUrl(baseUrl: string): string {
  const cleaned = baseUrl.replace(/\/+$/, "");
  return `${cleaned}/v1/mcp`;
}

async function postJsonRpc(
  url: string,
  body: JsonRpcRequest,
  sessionId: string | undefined,
  signal: AbortSignal,
): Promise<JsonRpcResponse & { __sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (sessionId) {
    headers["Mcp-Session-Id"] = sessionId;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new Error(`MCP request failed: HTTP ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  const sessionIdFromResponse = res.headers.get("mcp-session-id") ?? undefined;

  // Parse SSE-style response: "event: message\ndata: {...}"
  const dataMatch = text.match(/data: (.+)/s);
  const dataText = dataMatch ? dataMatch[1].trim() : text.trim();

  let parsed: JsonRpcResponse;
  try {
    parsed = JSON.parse(dataText) as JsonRpcResponse;
  } catch {
    throw new Error(
      `MCP response is not valid JSON: ${dataText.slice(0, 200)}`,
    );
  }

  if (parsed.error) {
    throw new Error(
      `MCP error: ${parsed.error.message} (code ${parsed.error.code})`,
    );
  }

  return {
    ...parsed,
    id: parsed.id ?? body.id,
    ...(sessionIdFromResponse ? { __sessionId: sessionIdFromResponse } : {}),
  };
}

export async function createMcpSession(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<McpSession> {
  const url = buildUrl(baseUrl);
  const abort = signal ?? AbortSignal.timeout(INIT_TIMEOUT_MS);

  // Step 1: Initialize
  const initResponse = (await postJsonRpc(
    url,
    {
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: MCP_VERSION,
        capabilities: {},
        clientInfo: { name: "pi-ts-aperture", version: "0.6.0" },
      },
      id: 1,
    },
    undefined,
    abort,
  )) as JsonRpcResponse & { __sessionId?: string };

  const sessionId = initResponse.__sessionId;
  if (!sessionId) {
    throw new Error("MCP initialize response missing Mcp-Session-Id header");
  }

  const initResult = initResponse.result as McpInitializeResult | undefined;
  if (!initResult || initResult.protocolVersion !== MCP_VERSION) {
    throw new Error(
      `MCP initialize returned unexpected result: ${JSON.stringify(initResult)}`,
    );
  }

  // Step 2: Send notifications/initialized (fire-and-forget)
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Session-Id": sessionId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Notification is best-effort
  }

  return {
    async listTools(callSignal?: AbortSignal): Promise<McpTool[]> {
      const s = callSignal ?? AbortSignal.timeout(CALL_TIMEOUT_MS);
      const res = await postJsonRpc(
        url,
        { jsonrpc: "2.0", method: "tools/list", id: 2 },
        sessionId,
        s,
      );
      const result = res.result as { tools?: McpTool[] } | undefined;
      return result?.tools ?? [];
    },

    async callTool(
      name: string,
      args: Record<string, unknown>,
      callSignal?: AbortSignal,
    ): Promise<McpCallResult> {
      const s = callSignal ?? AbortSignal.timeout(CALL_TIMEOUT_MS);
      const res = await postJsonRpc(
        url,
        {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name, arguments: args },
          id: nextId++,
        },
        sessionId,
        s,
      );
      const result = res.result as McpCallResult | undefined;
      if (!result) {
        throw new Error(`MCP tools/call returned empty result for ${name}`);
      }
      return result;
    },

    async listResourceTemplates(
      callSignal?: AbortSignal,
    ): Promise<McpResourceTemplate[]> {
      const s = callSignal ?? AbortSignal.timeout(CALL_TIMEOUT_MS);
      const res = await postJsonRpc(
        url,
        { jsonrpc: "2.0", method: "resources/templates/list", id: nextId++ },
        sessionId,
        s,
      );
      const result = res.result as
        | { resourceTemplates?: McpResourceTemplate[] }
        | undefined;
      return result?.resourceTemplates ?? [];
    },

    async listResources(callSignal?: AbortSignal): Promise<McpResource[]> {
      const s = callSignal ?? AbortSignal.timeout(CALL_TIMEOUT_MS);
      const res = await postJsonRpc(
        url,
        { jsonrpc: "2.0", method: "resources/list", id: nextId++ },
        sessionId,
        s,
      );
      const result = res.result as { resources?: McpResource[] } | undefined;
      return result?.resources ?? [];
    },

    async readResource(
      uri: string,
      callSignal?: AbortSignal,
    ): Promise<McpReadResourceResult> {
      const s = callSignal ?? AbortSignal.timeout(CALL_TIMEOUT_MS);
      const res = await postJsonRpc(
        url,
        {
          jsonrpc: "2.0",
          method: "resources/read",
          params: { uri },
          id: nextId++,
        },
        sessionId,
        s,
      );
      const result = res.result as McpReadResourceResult | undefined;
      if (!result) {
        throw new Error(`MCP resources/read returned empty result for ${uri}`);
      }
      return result;
    },

    close(): void {
      // No explicit close in Streamable HTTP; session expires server-side
    },
  };
}
