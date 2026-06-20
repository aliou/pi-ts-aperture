/**
 * JSON-RPC helpers and message validation for the MCP Apps host bridge.
 */

import type { McpAppHostContext } from "./types";

export const JSONRPC_VERSION = "2.0";

export const errorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface UiInitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  hostInfo: { name: string; version: string };
  hostCapabilities: Record<string, unknown>;
  hostContext: McpAppHostContext;
}

/** Methods the host bridge will accept from the iframe. */
export const allowedBridgeMethods = new Set([
  "ui/initialize",
  "tools/call",
  "ui/message",
  "ui/open-link",
]);

export function isJsonRpcMessage(data: unknown): data is JsonRpcMessage {
  if (!data || typeof data !== "object") return false;
  const msg = data as Record<string, unknown>;
  return msg.jsonrpc === JSONRPC_VERSION && typeof msg.method === "string";
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "id" in msg && msg.id !== undefined && msg.id !== null;
}

export function successResponse(
  id: number | string,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

export function errorResponse(
  id: number | string | undefined,
  error: JsonRpcError,
): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, error };
}

export function parseErrorResponse(): JsonRpcResponse {
  return errorResponse(undefined, {
    code: errorCodes.parseError,
    message: "Parse error",
  });
}

export class JsonRpcMethodError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export function requireStringParam(
  params: Record<string, unknown> | undefined,
  key: string,
): string {
  const value = params?.[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new JsonRpcMethodError(
      errorCodes.invalidParams,
      `Missing or invalid parameter: ${key}`,
    );
  }
  return value;
}

export function requireRecordParam(
  params: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> {
  const value = params?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JsonRpcMethodError(
      errorCodes.invalidParams,
      `Missing or invalid parameter: ${key}`,
    );
  }
  return value as Record<string, unknown>;
}
