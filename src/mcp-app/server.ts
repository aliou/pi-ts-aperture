/**
 * MCP Apps host HTTP/WebSocket server.
 *
 * Serves a wrapper HTML page and proxies JSON-RPC between a sandboxed iframe
 * and a host bridge.
 */

import { randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import {
  WebSocket,
  WebSocketServer,
  type WebSocket as WebSocketType,
} from "ws";
import {
  allowedBridgeMethods,
  errorCodes,
  errorResponse,
  isJsonRpcMessage,
  isRequest,
  type JsonRpcMessage,
  JsonRpcMethodError,
  type JsonRpcResponse,
  parseErrorResponse,
  requireRecordParam,
  requireStringParam,
  successResponse,
  type UiInitializeResult,
} from "./protocol";
import type { McpAppBridge, McpAppHost, McpAppHostOptions } from "./types";
import { defaultHostContext, generateWrapperHtml } from "./wrapper";

const MAX_MESSAGE_BYTES = 1024 * 1024; // 1 MiB

export type { McpAppHost };

export async function startMcpAppHost(
  options: McpAppHostOptions,
): Promise<McpAppHost> {
  const bindHost = options.bindHost ?? "127.0.0.1";
  const token = options.token ?? randomBytes(16).toString("hex");
  const abortController = new AbortController();
  const abort = options.signal
    ? AbortSignal.any([options.signal, abortController.signal])
    : abortController.signal;

  const hostContext = defaultHostContext(options.hostContext);

  const httpServer = createServer(handleHttpRequest);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const clients = new Set<WebSocketType>();

  wss.on("connection", (ws, req) => {
    if (!validateTokenFromUrl(req)) {
      ws.close(1008, "Invalid token");
      return;
    }

    clients.add(ws);

    ws.on("message", async (rawData, isBinary) => {
      if (isBinary) {
        sendJson(
          ws,
          errorResponse(undefined, {
            code: errorCodes.invalidRequest,
            message: "Binary messages are not supported",
          }),
        );
        return;
      }

      const data =
        rawData instanceof ArrayBuffer
          ? Buffer.from(rawData)
          : Array.isArray(rawData)
            ? Buffer.concat(rawData)
            : rawData;

      if (data.length > MAX_MESSAGE_BYTES) {
        sendJson(
          ws,
          errorResponse(undefined, {
            code: errorCodes.invalidRequest,
            message: "Message too large",
          }),
        );
        return;
      }

      let message: JsonRpcMessage;
      try {
        message = JSON.parse(data.toString()) as JsonRpcMessage;
      } catch {
        sendJson(ws, parseErrorResponse());
        return;
      }

      // eslint-disable-next-line no-console
      console.log(
        "[mcp-app] recv:",
        message.method,
        isRequest(message) ? message.id : "-",
      );
      await handleMessage(ws, message, options.bridge, abort);
    });

    ws.on("close", () => {
      clients.delete(ws);
    });

    ws.on("error", (err) => {
      // eslint-disable-next-line no-console
      console.error("[mcp-app-host] WebSocket error:", err);
    });
  });

  return new Promise<McpAppHost>((resolve, reject) => {
    httpServer.listen({ host: bindHost, port: 0 }, () => {
      const address = httpServer.address() as AddressInfo;
      const url = `http://${bindHost}:${address.port}/?token=${encodeURIComponent(token)}`;

      abort.addEventListener("abort", () => {
        closeAll();
      });

      let closing = false;

      resolve({
        url,
        sendNotification(method: string, params?: unknown): void {
          const msg = { jsonrpc: "2.0", method, params };
          for (const client of clients) {
            sendJson(client, msg);
          }
        },
        close: async () => {
          if (closing) return;
          closing = true;
          abortController.abort();
          await closeAll();
        },
      });
    });

    httpServer.on("error", reject);
  });

  function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
  ): void {
    const url = parseRequestUrl(req, bindHost);
    if (url.searchParams.get("token") !== token) {
      res.writeHead(403, { "Content-Type": "text/plain" });
      res.end("Forbidden");
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      const address = httpServer.address() as AddressInfo | null;
      const port = address?.port ?? Number.parseInt(url.port, 10);
      const wsUrl = `ws://${bindHost}:${port}/ws?token=${encodeURIComponent(token)}`;
      const html = generateWrapperHtml({
        appHtml: options.appHtml,
        wsUrl,
        title: options.title,
      });

      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self' blob:;",
      });
      res.end(html);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }

  async function closeAll(): Promise<void> {
    for (const client of clients) {
      client.terminate();
    }
    clients.clear();

    return new Promise<void>((resolveClose) => {
      wss.close(() => {
        httpServer.close(() => resolveClose());
      });
    });
  }

  function validateTokenFromUrl(req: IncomingMessage): boolean {
    const url = parseRequestUrl(req, bindHost);
    return url.searchParams.get("token") === token;
  }

  async function handleMessage(
    ws: WebSocket,
    message: JsonRpcMessage,
    bridge: McpAppBridge,
    signal: AbortSignal,
  ): Promise<void> {
    if (!isJsonRpcMessage(message)) {
      sendJson(
        ws,
        errorResponse(undefined, {
          code: errorCodes.invalidRequest,
          message: "Invalid JSON-RPC message",
        }),
      );
      return;
    }

    // eslint-disable-next-line no-console
    console.log(
      "[mcp-app] handle:",
      message.method,
      isRequest(message) ? message.id : "-",
    );
    if (message.method === "ui/initialize") {
      const initResult: UiInitializeResult = {
        protocolVersion: "2024-11-05",
        capabilities: {
          ui: {
            displayModes: ["inline"],
            notifications: true,
          },
        },
        hostInfo: { name: "pi-ts-aperture", version: "0.6.1" },
        hostCapabilities: {
          ui: {
            displayModes: ["inline"],
            notifications: true,
          },
        },
        hostContext,
      };

      if (isRequest(message)) {
        sendJson(ws, successResponse(message.id, initResult));
      }

      // Confirm initialization to the app.
      sendJson(ws, {
        jsonrpc: "2.0",
        method: "ui/notifications/initialized",
        params: {},
      });
      return;
    }

    if (!allowedBridgeMethods.has(message.method)) {
      if (isRequest(message)) {
        sendJson(
          ws,
          errorResponse(message.id, {
            code: errorCodes.methodNotFound,
            message: `Method not allowed: ${message.method}`,
          }),
        );
      }
      return;
    }

    const requestId = isRequest(message) ? message.id : undefined;

    try {
      const result = await executeBridgeMethod(
        message.method,
        message.params as Record<string, unknown> | undefined,
        bridge,
        signal,
      );

      if (requestId !== undefined) {
        sendJson(ws, successResponse(requestId, result));
      }
    } catch (error) {
      if (requestId === undefined) return;

      const rpcError =
        error instanceof JsonRpcMethodError
          ? { code: error.code, message: error.message }
          : {
              code: errorCodes.internalError,
              message: error instanceof Error ? error.message : String(error),
            };

      sendJson(ws, errorResponse(requestId, rpcError));
    }
  }
}

async function executeBridgeMethod(
  method: string,
  params: Record<string, unknown> | undefined,
  bridge: McpAppBridge,
  signal: AbortSignal,
): Promise<unknown> {
  // eslint-disable-next-line no-console
  console.log("[mcp-app] bridge method:", method, JSON.stringify(params));
  switch (method) {
    case "tools/call": {
      const name = requireStringParam(params, "name");
      const args = requireRecordParam(params, "arguments");
      const result = await bridge.callTool(name, args, signal);
      // eslint-disable-next-line no-console
      console.log(
        "[mcp-app] tool result:",
        name,
        JSON.stringify(result).slice(0, 200),
      );
      return result;
    }

    case "ui/message": {
      const content = params?.content;
      if (content === undefined) {
        throw new JsonRpcMethodError(
          errorCodes.invalidParams,
          "ui/message requires content",
        );
      }
      return bridge.sendMessage(content, signal);
    }

    case "ui/open-link": {
      const url = requireStringParam(params, "url");
      if (bridge.openLink) {
        return bridge.openLink(url, signal);
      }
      return null;
    }

    default:
      throw new JsonRpcMethodError(
        errorCodes.methodNotFound,
        `Method not allowed: ${method}`,
      );
  }
}

function sendJson(
  ws: WebSocket,
  msg: JsonRpcResponse | { jsonrpc: string; method: string; params?: unknown },
): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function parseRequestUrl(req: IncomingMessage, defaultHost: string): URL {
  const host = req.headers.host ?? defaultHost;
  return new URL(req.url ?? "/", `http://${host}`);
}
