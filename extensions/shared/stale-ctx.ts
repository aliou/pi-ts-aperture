/**
 * True when `error` is pi's stale-context guard error. On session
 * replacement or reload pi invalidates the old extension runner, after
 * which every ctx getter and pi action throws this. Deferred continuations
 * that catch it must bail silently: the replacement session's
 * `session_start` re-runs the work with a fresh ctx, and pi installs no
 * `unhandledRejection` handler, so letting it escape is fatal to the
 * process (Node's default `--unhandled-rejections=throw`).
 */
export function isStaleCtxError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.startsWith("This extension ctx is stale")
  );
}
