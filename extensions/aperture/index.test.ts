import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock the factory's heavyweight dependencies so default(pi) only registers
// event handlers without touching config files, providers, or settings.
vi.mock("../shared/config/loader", () => ({
  configLoader: {
    load: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn(),
  },
}));

vi.mock("./dedicated/runtime", () => ({
  registerDedicatedProvider: vi.fn(),
  reconcileDedicatedProvider: vi.fn(),
}));

vi.mock("./settings", () => ({
  registerApertureSettings: vi.fn(),
}));

vi.mock("./onboarding", () => ({
  registerOnboarding: vi.fn(),
}));

// Keep retryable-errors real so the existing message_end retry-tagging path
// is exercised exactly as shipped.

import type { AssistantMessage } from "@earendil-works/pi-ai";
import { configLoader } from "../shared/config/loader";
import apertureExtension from "./index";

type MessageEndHandler = (event: {
  type: "message_end";
  message: AssistantMessage;
}) => unknown;

/** Minimal pi stub that records `.on` registrations as no-op calls. */
function fakePi() {
  const handlers = new Map<string, MessageEndHandler>();
  const pi = {
    on: vi.fn((event: string, cb: MessageEndHandler) => {
      handlers.set(event, cb);
    }),
    events: { on: vi.fn(), emit: vi.fn() },
    registerProvider: vi.fn(),
    unregisterProvider: vi.fn(),
    setModel: vi.fn(),
  };
  return { pi, handlers };
}

function assistantMessage(
  overrides: Partial<AssistantMessage>,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "openai-codex-responses",
    provider: "openai-codex",
    model: "openai-codex/openai-codex/gpt-5.6-luna",
    usage: { input: 0, output: 0, totalTokens: 0 } as never,
    stopReason: "endTurn",
    timestamp: 0,
    ...overrides,
  } as AssistantMessage;
}

describe("aperture message_end handler — persisted model id", () => {
  beforeEach(() => {
    vi.mocked(configLoader.getConfig).mockReturnValue({
      baseUrl: "http://gateway.test",
      onboardingDone: true,
      onboarding: { enabled: false },
      proxy: {
        enabled: true,
        upstreamProviders: [
          { id: "openai-codex", shouldCheckGatewayModels: false },
        ],
      },
      dedicated: { enabled: false, providers: [] },
      connectors: { enabled: false, pinnedTools: [], discoveryTools: true },
    } as never);
  });

  function effectiveModel(
    handler: MessageEndHandler | undefined,
    message: AssistantMessage,
  ): string {
    const result = handler?.({ type: "message_end", message }) as
      | { message: AssistantMessage }
      | undefined;
    // The handler returns undefined when it leaves the message alone, which
    // is the correct outcome for an already-bare id. The persisted model is
    // then the original input.
    return (result?.message ?? message).model;
  }

  // Regression (session 01a05812): the openai-codex-responses adapter
  // persists the transport-qualified model id the proxy stream dispatch
  // produced ("openai-codex/gpt-5.6-luna", sometimes doubled to
  // "openai-codex/openai-codex/gpt-5.6-luna") into the assistant message.
  // On resume, Pi's getModel(provider, "<qualified>") lookup misses the
  // bare registry id and falls back to a default with a warning. The
  // message_end handler must normalize the persisted model id back to the
  // bare public id before Pi saves the message.
  test("normalizes a qualified model id on a persisted assistant message", async () => {
    const { pi, handlers } = fakePi();
    await apertureExtension(pi as never);

    expect(
      effectiveModel(
        handlers.get("message_end"),
        assistantMessage({
          provider: "openai-codex",
          model: "openai-codex/openai-codex/gpt-5.6-luna",
        }),
      ),
    ).toBe("gpt-5.6-luna");
  });

  test("leaves a bare model id untouched", async () => {
    const { pi, handlers } = fakePi();
    await apertureExtension(pi as never);

    expect(
      effectiveModel(
        handlers.get("message_end"),
        assistantMessage({
          provider: "openai-codex",
          model: "gpt-5.6-luna",
        }),
      ),
    ).toBe("gpt-5.6-luna");
  });
});
