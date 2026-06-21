import { Alert, Steps } from "@aliou/pi-utils-ui";
import { type Component, Key, matchesKey } from "@earendil-works/pi-tui";

export interface AsyncEditorOptions {
  /** Loader invoked once on construction. Resolves with the real editor. */
  loader: () => Promise<Component>;
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
 * Uses `Steps`/`Alert` from `@aliou/pi-utils-ui` so the loading and error
 * states are visible and readable while waiting on the gateway.
 */
export class AsyncEditor implements Component {
  private editor: Component | null = null;
  private error: string | null = null;
  private readonly steps: Steps;
  private readonly onCancel: (() => void) | undefined;

  constructor(options: AsyncEditorOptions) {
    const { loader, requestRender, onCancel, loadingDescription } = options;
    this.onCancel = onCancel;
    this.steps = new Steps({
      items: [
        {
          title: "Connecting to Aperture...",
          description: loadingDescription,
          status: "active",
        },
      ],
    });

    void loader()
      .then((editor) => {
        this.editor = editor;
        this.error = null;
        requestRender();
      })
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : String(error);
        requestRender();
      });
  }

  render(width: number): string[] {
    if (this.editor) return this.editor.render(width);
    if (this.error) {
      return new Alert({
        title: "Failed to load from Aperture",
        message: this.error,
        icon: "!",
      }).render(width);
    }
    return this.steps.render(width);
  }

  invalidate(): void {
    this.editor?.invalidate?.();
  }

  handleInput(data: string): void {
    // Esc while still loading cancels the submenu.
    if (this.editor === null && matchesKey(data, Key.escape)) {
      this.onCancel?.();
      return;
    }
    this.editor?.handleInput?.(data);
  }
}
