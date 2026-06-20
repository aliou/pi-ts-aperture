/**
 * Types for an MCP Apps host bridge.
 *
 * This module is Pi-agnostic. It defines the contract between a sandboxed
 * MCP App iframe and a host runtime that proxies requests to an MCP server.
 */

export type McpAppTheme = "light" | "dark";

export interface McpAppHostContext {
  theme: McpAppTheme;
  locale: string;
  timezone: string;
  displayMode: "inline" | "fullscreen" | "pip";
  containerWidth?: number;
  containerHeight?: number;
}

/**
 * Host-side bridge that the MCP App iframe drives over postMessage.
 *
 * Implementations are provided by the host environment (e.g. Pi).
 */
export interface McpAppBridge {
  /**
   * Execute a tool on the MCP server.
   */
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;

  /**
   * Send a user-visible message to the host conversation.
   */
  sendMessage(content: unknown, signal?: AbortSignal): Promise<unknown>;

  /**
   * Open a URL in the user's default browser.
   */
  openLink?(url: string, signal?: AbortSignal): Promise<unknown>;
}

/**
 * Options for launching an MCP App host server.
 */
export interface McpAppHostOptions {
  /** HTML content of the MCP App to embed in the iframe. */
  appHtml: string;
  /** Page title. */
  title?: string;
  /** Host context exposed to the app via ui/initialize. */
  hostContext?: Partial<McpAppHostContext>;
  /** Host bridge implementation. */
  bridge: McpAppBridge;
  /** Host address to bind the HTTP/WebSocket server to. */
  bindHost?: string;
  /** Optional access token for the wrapper and WebSocket endpoints. */
  token?: string;
  /** Optional abort signal to stop the server. */
  signal?: AbortSignal;
}

/**
 * A running MCP App host instance.
 */
export interface McpAppHost {
  /** URL of the wrapper HTML page hosting the MCP App. */
  url: string;
  /** Send a JSON-RPC notification to all connected iframe clients. */
  sendNotification(method: string, params?: unknown): void;
  /** Stop the server and close all connections. */
  close(): Promise<void>;
}
