/**
 * Pi's retry classifier (`isRetryableAssistantError` in `@earendil-works/pi-ai`)
 * matches error text against a hardcoded pattern list extensions cannot extend.
 * Tagging the message with a marker Pi already knows is the way in.
 */

/** Transient gateway errors Pi does not already treat as retryable. */
const TRANSIENT_APERTURE_ERROR_PATTERNS: RegExp[] = [/aperture is restarting/i];

/** Matches Pi's `service.?unavailable` retryable pattern. */
const RETRYABLE_MARKER = "service unavailable";

export function isTransientApertureError(message: string): boolean {
  return TRANSIENT_APERTURE_ERROR_PATTERNS.some((pattern) =>
    pattern.test(message),
  );
}

/** Returns the tagged message, or `undefined` to leave it alone. */
export function markRetryableApertureError(
  message: string,
): string | undefined {
  if (!isTransientApertureError(message)) return undefined;
  if (message.toLowerCase().includes(RETRYABLE_MARKER)) return undefined;
  return `${message} (${RETRYABLE_MARKER})`;
}
