import { describe, expect, test } from "vitest";
import {
  isTransientApertureError,
  markRetryableApertureError,
} from "./retryable-errors";

describe("isTransientApertureError", () => {
  test("matches the gateway restart error", () => {
    expect(
      isTransientApertureError(
        "Error: aperture is restarting, retry this request",
      ),
    ).toBe(true);
  });

  test("matches regardless of case", () => {
    expect(isTransientApertureError("Aperture Is Restarting")).toBe(true);
  });

  test("ignores unrelated errors", () => {
    expect(isTransientApertureError("invalid api key")).toBe(false);
  });
});

describe("markRetryableApertureError", () => {
  test("appends a marker Pi treats as retryable", () => {
    expect(
      markRetryableApertureError(
        "Error: aperture is restarting, retry this request",
      ),
    ).toBe(
      "Error: aperture is restarting, retry this request (service unavailable)",
    );
  });

  test("returns undefined when already tagged, so the message is left alone", () => {
    expect(
      markRetryableApertureError(
        "aperture is restarting (service unavailable)",
      ),
    ).toBeUndefined();
  });

  test("returns undefined for unrelated errors", () => {
    expect(markRetryableApertureError("invalid api key")).toBeUndefined();
  });
});
