/**
 * MCP Apps host bridge — generic, Pi-agnostic entry point.
 */

export {
  allowedBridgeMethods,
  errorCodes,
  errorResponse,
  isJsonRpcMessage,
  isRequest,
  JsonRpcMethodError,
  parseErrorResponse,
  successResponse,
} from "./protocol";
export type { McpAppHost } from "./server";
export { startMcpAppHost } from "./server";
export type {
  McpAppBridge,
  McpAppHostContext,
  McpAppHostOptions,
  McpAppTheme,
} from "./types";
export { generateWrapperHtml } from "./wrapper";
