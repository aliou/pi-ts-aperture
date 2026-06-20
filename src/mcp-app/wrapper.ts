/**
 * Generate the wrapper HTML for an MCP App host.
 *
 * The wrapper embeds the MCP App HTML inside a sandboxed iframe and sets up
 * a postMessage <-> WebSocket bridge.
 */

import type { McpAppHostContext } from "./types";

export interface WrapperHtmlOptions {
  appHtml: string;
  wsUrl: string;
  title?: string;
}

export function generateWrapperHtml(options: WrapperHtmlOptions): string {
  const title = options.title ?? "MCP App Host";
  // Escape '<' as a JS unicode escape so the app HTML cannot close our
  // <script> element prematurely (e.g. a </script> tag inside srcdoc).
  const appHtmlLiteral = JSON.stringify(options.appHtml).replace(
    /</g,
    "\\u003c",
  );
  const wsUrlLiteral = JSON.stringify(options.wsUrl).replace(/</g, "\\u003c");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: transparent; }
    iframe { width: 100%; height: 100%; border: none; }
  </style>
</head>
<body>
  <iframe id="mcp-app" sandbox="allow-scripts allow-forms"></iframe>
  <script>
    (function () {
      const iframe = document.getElementById('mcp-app');
      const ws = new WebSocket(${wsUrlLiteral});

      iframe.srcdoc = ${appHtmlLiteral};

      window.addEventListener('message', function (event) {
        if (event.source !== iframe.contentWindow) return;
        if (!event.data || event.data.jsonrpc !== '2.0') return;
        console.log('[mcp-app-host] iframe → server', event.data.method, event.data.id);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(event.data));
        }
      });

      ws.onmessage = function (event) {
        try {
          const msg = JSON.parse(event.data);
          console.log('[mcp-app-host] server → iframe', msg.method || msg.id, msg.result ? 'result' : msg.error ? 'error' : 'notif');
          iframe.contentWindow.postMessage(msg, '*');
        } catch (e) {
          console.error('Invalid message from bridge:', event.data);
        }
      };

      ws.onerror = function () {
        console.error('MCP bridge connection failed');
      };
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function defaultHostContext(
  overrides?: Partial<McpAppHostContext>,
): McpAppHostContext {
  return {
    theme: "dark",
    locale: "en-US",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    displayMode: "inline",
    ...overrides,
  };
}
