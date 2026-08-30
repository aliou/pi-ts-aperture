import { describe, expect, test } from "vitest";
import { parseApertureProvider, parseConnectorInfo } from "./types";

describe("parseApertureProvider", () => {
  test("fills defaults for absent optional fields", () => {
    expect(parseApertureProvider({ id: "openai", name: "OpenAI" })).toEqual({
      id: "openai",
      name: "OpenAI",
      description: "",
      models: [],
      compatibility: {},
    });
  });

  test("uses fallbackId when id is absent", () => {
    const parsed = parseApertureProvider({ name: "OpenAI" }, "openai");

    expect(parsed?.id).toBe("openai");
  });

  test("rejects when neither id nor fallbackId is available", () => {
    expect(parseApertureProvider({ name: "OpenAI" })).toBeNull();
  });

  test("defaults name to id", () => {
    expect(parseApertureProvider({ id: "openai" })?.name).toBe("openai");
  });

  // Parity with the replaced `name: record.name ?? id` preprocessing: an
  // unset optional string is `null` on the wire for most server languages,
  // and rejecting the provider over it would drop it from the catalog.
  test("treats a null name as absent", () => {
    expect(parseApertureProvider({ id: "openai", name: null })?.name).toBe(
      "openai",
    );
  });

  // Unknown-key survival is a runtime property of the parser's spread; the
  // declared type stays closed, so read them through a record view.
  test("preserves unknown keys", () => {
    const parsed = parseApertureProvider({
      id: "openai",
      auth_mode: "override",
      quota: { limit: 10 },
    }) as Record<string, unknown> | null;

    expect(parsed?.auth_mode).toBe("override");
    expect(parsed?.quota).toEqual({ limit: 10 });
  });

  test("preserves unknown compatibility keys alongside declared flags", () => {
    const parsed = parseApertureProvider({
      id: "openai",
      compatibility: { openai_chat: true, future_api: "maybe" },
    });

    expect(parsed?.compatibility).toEqual({
      openai_chat: true,
      future_api: "maybe",
    });
  });

  test("keeps requires_client_auth", () => {
    expect(
      parseApertureProvider({ id: "openai", requires_client_auth: true })
        ?.requires_client_auth,
    ).toBe(true);
  });

  // No key to fall back to, so a wrong-typed id leaves nothing usable.
  // Client-internal: populated after parsing, never on the wire. An inbound
  // copy under server-version skew would carry unvalidated pricing into
  // dedicated model construction.
  test("drops an inbound modelInfoById", () => {
    const parsed = parseApertureProvider({
      id: "openai",
      modelInfoById: { "gpt-5": { id: "gpt-5", pricing: { input: true } } },
    });

    expect(parsed).not.toBeNull();
    expect(parsed?.modelInfoById).toBeUndefined();
  });

  test("rejects a non-string id in an array-shaped response", () => {
    expect(parseApertureProvider({ id: 42, name: "OpenAI" })).toBeNull();
  });

  // Parity with the replaced preprocessing, which overwrote `record.id` with
  // the map key before validating.
  test("falls back to the map key when id is not a string", () => {
    expect(parseApertureProvider({ id: null }, "openai")?.id).toBe("openai");
    expect(parseApertureProvider({ id: 42 }, "openai")?.id).toBe("openai");
  });

  test("rejects a non-string name", () => {
    expect(parseApertureProvider({ id: "openai", name: 42 })).toBeNull();
  });

  test("rejects a non-string entry in models", () => {
    expect(
      parseApertureProvider({ id: "openai", models: ["gpt-5", 42] }),
    ).toBeNull();
  });

  test("rejects a non-array models", () => {
    expect(parseApertureProvider({ id: "openai", models: "gpt-5" })).toBeNull();
  });

  test("rejects a non-boolean declared compatibility flag", () => {
    expect(
      parseApertureProvider({
        id: "openai",
        compatibility: { openai_chat: "yes" },
      }),
    ).toBeNull();
  });

  test("rejects an array compatibility", () => {
    expect(
      parseApertureProvider({ id: "openai", compatibility: [] }),
    ).toBeNull();
  });

  test("rejects a non-boolean requires_client_auth", () => {
    expect(
      parseApertureProvider({ id: "openai", requires_client_auth: "yes" }),
    ).toBeNull();
  });

  test("rejects non-objects", () => {
    expect(parseApertureProvider(null)).toBeNull();
    expect(parseApertureProvider("openai")).toBeNull();
    expect(parseApertureProvider([])).toBeNull();
  });
});

describe("parseConnectorInfo", () => {
  test("fills string defaults", () => {
    expect(parseConnectorInfo({ id: "github" })).toEqual({
      id: "github",
      description: "",
      protocol: "",
      provider: "",
      category: "",
      status: "",
    });
  });

  test("preserves unknown keys", () => {
    const parsed = parseConnectorInfo({ id: "github", tools: 12 }) as Record<
      string,
      unknown
    > | null;

    expect(parsed?.tools).toBe(12);
  });

  test("rejects a missing or non-string id", () => {
    expect(parseConnectorInfo({})).toBeNull();
    expect(parseConnectorInfo({ id: 42 })).toBeNull();
  });

  test("rejects a non-string declared field", () => {
    expect(parseConnectorInfo({ id: "github", status: 1 })).toBeNull();
    expect(parseConnectorInfo({ id: "github", auth_type: 1 })).toBeNull();
  });
});
