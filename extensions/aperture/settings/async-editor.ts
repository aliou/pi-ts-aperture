import { EmptyState } from "@aliou/pi-utils-ui";
import { type Component, Key, matchesKey } from "@earendil-works/pi-tui";

/**
 * Turn a raw fetch/HTTP error into a short, human-readable reason for the
 * settings UI. The full error still goes to logs; this is what the user sees.
 */
function summarizeError(error: unknown): string {
  if (error instanceof DOMException) {
    // AbortSignal.timeout() fires as a TimeoutError, not AbortError.
    if (error.name === "TimeoutError")
      return "the gateway took too long to respond";
    return error.message || error.name;
  }
  const msg = error instanceof Error ? error.message : String(error);
  // ApertureClient throws e.g. "[Aperture] GET /api/providers: -> 504 Gateway Timeout".
  const http = msg.match(/->\s*(\d{3})\s*(.*)/);
  if (http) return `gateway returned ${http[1]} ${http[2] ?? ""}`.trim();
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|network/i.test(msg))
    return "could not connect to the gateway";
  return msg;
}

export interface AsyncEditorOptions {
  /**
   * Loader invoked once on construction. Resolves with the real editor.
   * Receives an AbortSignal that fires when the user cancels loading with
   * Esc, so the in-flight fetch can be cancelled rather than running to
   * completion (or the 5s timeout) in the background.
   */
  loader: (signal: AbortSignal) => Promise<Component>;
  /** Redraw hook from {@link SettingsSubmenuContext}. Required to swap views. */
  requestRender: () => void;
  /** Called when the user aborts loading with Esc while still pending. */
  onCancel?: () => void;
  /** Inline description shown under the loading title. */
  loadingDescription?: string;
}

/**
 * Wrapper Component that renders a loading indicator while the real editor
 * is fetched, then swaps the underlying editor and requests a redraw.
 *
 * Uses `EmptyState` from `@aliou/pi-utils-ui` for the loading and error
 * views, so they render flat inside the settings panel instead of nesting
 * another bordered box.
 */
export class AsyncEditor implements Component {
  private editor: Component | null = null;
  private error: string | null = null;
  private readonly loadingDescription?: string;
  private readonly onCancel: (() => void) | undefined;
  private readonly loader: (signal: AbortSignal) => Promise<Component>;
  private readonly requestRender: () => void;
  private abortController: AbortController;
  /** True once the submenu is closed or cancelled, so late settles are ignored. */
  private cancelled = false;

  constructor(options: AsyncEditorOptions) {
    const { loader, requestRender, onCancel, loadingDescription } = options;
    this.onCancel = onCancel;
    this.loadingDescription = loadingDescription;
    this.loader = loader;
    this.requestRender = requestRender;
    this.abortController = new AbortController();
    this.runLoader();
  }

  /** Kick off (or re-kick off) the loader with a fresh abort signal. */
  private runLoader(): void {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    void this.loader(signal)
      .then((editor) => {
        // A late resolve after Esc/cancel, or after a retry superseded this
        // attempt, must not swap in an editor the user no longer wants.
        if (this.cancelled || signal.aborted) return;
        this.editor = editor;
        this.error = null;
        this.requestRender();
      })
      .catch((error: unknown) => {
        // AbortError means we cancelled intentionally; ignore it.
        if (
          this.cancelled ||
          signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        this.error = summarizeError(error);
        this.requestRender();
      });
  }

  render(width: number): string[] {
    if (this.editor) return this.editor.render(width);
    if (this.error) {
      return new EmptyState({
        title: "Couldn't reach Aperture",
        description: `${this.error} · R retry · Esc to go back`,
      }).render(width);
    }
    return new EmptyState({
      title: "Connecting to Aperture",
      description: `${this.loadingDescription ?? "Fetching gateway data"} · Esc to cancel`,
    }).render(width);
  }

  invalidate(): void {
    this.editor?.invalidate?.();
  }

  handleInput(data: string): void {
    // No editor yet: Esc cancels, R retries (only meaningful on error).
    if (this.editor === null) {
      if (matchesKey(data, Key.escape)) {
        this.cancel();
        return;
      }
      if (this.error !== null && (data === "r" || data === "R")) {
        this.retry();
        return;
      }
    }
    this.editor?.handleInput?.(data);
  }

  /** Clear the error and re-run the loader with a fresh abort signal. */
  private retry(): void {
    if (this.cancelled) return;
    // Drop any still-pending attempt before starting a new one.
    this.abortController.abort();
    this.error = null;
    this.runLoader();
    this.requestRender();
  }

  /** Mark the editor as cancelled, abort the in-flight fetch, and notify the caller. */
  private cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.abortController.abort();
    this.onCancel?.();
  }
}
