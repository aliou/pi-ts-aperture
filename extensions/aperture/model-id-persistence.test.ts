import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  MessageEndEvent,
  MessageEndEventResult,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock the heavyweight deps so default(pi) only registers event handlers.
// retryable-errors stays real: the handler under test composes with it.
// NOTE: vitest.config sets `mockReset: true`, which wipes factory-set
// implementations before each test; return values are re-applied in
// beforeEach below.
vi.mock("../shared/config/loader", () => ({
  configLoader: {
    load: vi.fn(),
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

import { configLoader } from "../shared/config/loader";
import registerAperture from "./index";

type MessageEndHandler = (
  event: MessageEndEvent,
  ctx: ExtensionContext,
) => MessageEndEventResult | undefined;

type RegistryEntry = { provider: string; id: string };

/**
 * Build a minimal `ExtensionContext` whose `modelRegistry.find(provider, id)`
 * resolves truthy for exactly the supplied `(provider, id)` pairs. The handler
 * only ever reads `find`'s truthiness, so a stand-in object suffices.
 */
function makeCtx(models: RegistryEntry[] = []): ExtensionContext {
  // `\u0000` cannot occur in provider/model ids, so it is an unambiguous
  // separator for the lookup key.
  const known = new Set(models.map((m) => `${m.provider}\u0000${m.id}`));
  return {
    modelRegistry: {
      find: (provider: string, id: string) =>
        known.has(`${provider}\u0000${id}`)
          ? ({ provider, id } as never)
          : undefined,
    },
  } as unknown as ExtensionContext;
}

function proxyConfig(
  upstreamProviders: { id: string; enabled?: boolean }[] = [],
  enabled = true,
): ReturnType<typeof configLoader.getConfig> {
  return {
    proxy: { enabled, upstreamProviders },
  } as ReturnType<typeof configLoader.getConfig>;
}

function assistantMessage(
  model: string,
  provider = "openai-codex",
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: "openai-codex-responses",
    provider,
    model,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  } as AssistantMessage;
}

describe("message_end model id persistence (#101)", () => {
  let messageEnd: MessageEndHandler;

  beforeEach(async () => {
    vi.mocked(configLoader.load).mockResolvedValue(undefined);
    // Proxy-enabled by default with openai-codex and openrouter as active
    // upstream providers. Individual tests override this for disabled /
    // unproxied / disabled-provider scenarios.
    vi.mocked(configLoader.getConfig).mockReturnValue(
      proxyConfig([{ id: "openai-codex" }, { id: "openrouter" }]),
    );
    const handlers = new Map<string, (event: never) => unknown>();
    const pi = {
      on: (event: string, handler: (event: never) => unknown) => {
        handlers.set(event, handler);
      },
      events: { on: vi.fn(), emit: vi.fn() },
    } as unknown as ExtensionAPI;
    await registerAperture(pi);
    const handler = handlers.get("message_end");
    if (!handler) throw new Error("message_end handler was not registered");
    messageEnd = handler as MessageEndHandler;
  });

  test("normalizes a qualified model id on a persisted assistant message", () => {
    const ctx = makeCtx([{ provider: "openai-codex", id: "gpt-5.6-luna" }]);
    const message = assistantMessage("openai-codex/openai-codex/gpt-5.6-luna");
    const result = messageEnd({ type: "message_end", message }, ctx);
    const persisted = result?.message ?? message;
    expect(persisted.role).toBe("assistant");
    expect((persisted as AssistantMessage).model).toBe("gpt-5.6-luna");
  });

  test("leaves a bare model id untouched", () => {
    const ctx = makeCtx([{ provider: "openai-codex", id: "gpt-5.6-luna" }]);
    const message = assistantMessage("gpt-5.6-luna");
    const result = messageEnd({ type: "message_end", message }, ctx);
    const persisted = result?.message ?? message;
    expect((persisted as AssistantMessage).model).toBe("gpt-5.6-luna");
  });

  test("leaves an unproxied provider message untouched", () => {
    // anthropic is not among the configured upstream providers.
    const ctx = makeCtx([{ provider: "anthropic", id: "claude-opus" }]);
    const message = assistantMessage(
      "anthropic/anthropic/claude-opus",
      "anthropic",
    );
    const result = messageEnd({ type: "message_end", message }, ctx);
    expect(result).toBeUndefined();
    expect(message.model).toBe("anthropic/anthropic/claude-opus");
  });

  test("preserves a legitimate provider-prefixed public id (openrouter/auto)", () => {
    const ctx = makeCtx([
      { provider: "openrouter", id: "openrouter/auto" },
      { provider: "openrouter", id: "openrouter/free" },
    ]);
    const message = assistantMessage("openrouter/auto", "openrouter");
    const result = messageEnd({ type: "message_end", message }, ctx);
    expect(result).toBeUndefined();
    expect(message.model).toBe("openrouter/auto");
  });

  test("unwinds a doubled id to the longest registry-resolving candidate", () => {
    // openrouter/openrouter/auto -> openrouter/auto (the real public id),
    // not auto (which does not exist in the registry).
    const ctx = makeCtx([{ provider: "openrouter", id: "openrouter/auto" }]);
    const message = assistantMessage(
      "openrouter/openrouter/auto",
      "openrouter",
    );
    const result = messageEnd({ type: "message_end", message }, ctx);
    const persisted = result?.message ?? message;
    expect((persisted as AssistantMessage).model).toBe("openrouter/auto");
  });

  test("does not normalize a configured-but-disabled proxied provider", () => {
    vi.mocked(configLoader.getConfig).mockReturnValue(
      proxyConfig([{ id: "openai-codex", enabled: false }]),
    );
    const ctx = makeCtx([{ provider: "openai-codex", id: "gpt-5.6-luna" }]);
    const message = assistantMessage("openai-codex/openai-codex/gpt-5.6-luna");
    const result = messageEnd({ type: "message_end", message }, ctx);
    expect(result).toBeUndefined();
    expect(message.model).toBe("openai-codex/openai-codex/gpt-5.6-luna");
  });

  test("does not normalize when proxy mode is disabled", () => {
    vi.mocked(configLoader.getConfig).mockReturnValue(
      proxyConfig([{ id: "openai-codex" }], false),
    );
    const ctx = makeCtx([{ provider: "openai-codex", id: "gpt-5.6-luna" }]);
    const message = assistantMessage("openai-codex/openai-codex/gpt-5.6-luna");
    const result = messageEnd({ type: "message_end", message }, ctx);
    expect(result).toBeUndefined();
    expect(message.model).toBe("openai-codex/openai-codex/gpt-5.6-luna");
  });

  test("falls back to the fully stripped id when no candidate resolves", () => {
    // The registry has not loaded this model, so no candidate resolves; the
    // handler still unwinds the transport prefix to the bare public id,
    // preserving the original persistence fix.
    const ctx = makeCtx([]);
    const message = assistantMessage("openai-codex/openai-codex/gpt-5.6-luna");
    const result = messageEnd({ type: "message_end", message }, ctx);
    const persisted = result?.message ?? message;
    expect((persisted as AssistantMessage).model).toBe("gpt-5.6-luna");
  });

  test("composes model id normalization with retryable error tagging", () => {
    const ctx = makeCtx([{ provider: "openai-codex", id: "gpt-5.6-luna" }]);
    const message = assistantMessage(
      "openai-codex/openai-codex/gpt-5.6-luna",
      "openai-codex",
      {
        stopReason: "error",
        errorMessage: "aperture is restarting, retry this request",
      },
    );
    const result = messageEnd({ type: "message_end", message }, ctx);
    const persisted = result?.message as AssistantMessage | undefined;
    expect(persisted).toBeDefined();
    expect(persisted.model).toBe("gpt-5.6-luna");
    expect(persisted.stopReason).toBe("error");
    expect(persisted.errorMessage).toBe(
      "aperture is restarting, retry this request (service unavailable)",
    );
  });
});
