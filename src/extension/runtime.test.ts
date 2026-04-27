import { beforeEach, describe, expect, test, vi } from "vitest";
import { configLoader } from "../lib/config";
import { fetchGatewayModels } from "../lib/gateway";
import type { Api, Model } from "../lib/types";
import { ApertureRuntime } from "./runtime";

vi.mock("../lib/config", () => ({
  configLoader: {
    getConfig: vi.fn(),
  },
}));

vi.mock("../lib/gateway", () => ({
  fetchGatewayModels: vi.fn(),
}));

const getConfig = vi.mocked(configLoader.getConfig);
const fetchModels = vi.mocked(fetchGatewayModels);

function model(provider: string, id: string): Model<Api> {
  return { provider, id } as Model<Api>;
}

async function check(models: Model<Api>[]) {
  const notify = vi.fn();
  const runtime = new ApertureRuntime();

  await runtime.checkMissingModels(
    {
      getModels: () => models,
      notify,
    },
    "http://gateway.test",
  );

  return notify;
}

describe("ApertureRuntime.checkMissingModels", () => {
  beforeEach(() => {
    getConfig.mockReturnValue({
      baseUrl: "http://gateway.test",
      providers: [],
      checkGatewayModels: ["synthetic"],
    });
    fetchModels.mockResolvedValue([]);
  });

  test("matches gateway models by provider and id", async () => {
    fetchModels.mockResolvedValue([{ providerId: "openrouter", id: "foo" }]);

    const notify = await check([
      model("synthetic", "foo"),
      model("openrouter", "foo"),
    ]);

    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.calls[0][0]).toContain("synthetic: foo");
  });

  test("only checks configured providers", async () => {
    getConfig.mockReturnValue({
      baseUrl: "http://gateway.test",
      providers: [],
      checkGatewayModels: ["synthetic"],
    });
    fetchModels.mockResolvedValue([{ providerId: "synthetic", id: "foo" }]);

    const notify = await check([
      model("synthetic", "foo"),
      model("openrouter", "missing-openrouter"),
    ]);

    expect(notify).not.toHaveBeenCalled();
  });

  test("truncates missing models per provider", async () => {
    getConfig.mockReturnValue({
      baseUrl: "http://gateway.test",
      providers: [],
      checkGatewayModels: ["openrouter", "synthetic"],
    });
    fetchModels.mockResolvedValue([{ providerId: "synthetic", id: "syn-1" }]);

    const notify = await check([
      model("openrouter", "or-1"),
      model("openrouter", "or-2"),
      model("openrouter", "or-3"),
      model("openrouter", "or-4"),
      model("openrouter", "or-5"),
      model("openrouter", "or-6"),
      model("openrouter", "or-7"),
      model("synthetic", "syn-1"),
      model("synthetic", "syn-2"),
      model("synthetic", "syn-3"),
    ]);

    expect(notify).toHaveBeenCalledOnce();
    const message = notify.mock.calls[0][0];
    expect(message).toContain(
      "openrouter: or-1, or-2, or-3, or-4, or-5, 2 more",
    );
    expect(message).not.toContain("or-6");
    expect(message).not.toContain("or-7");
    expect(message).toContain("synthetic: syn-2, syn-3");
  });

  test("does not warn when all checked provider models exist", async () => {
    fetchModels.mockResolvedValue([
      { providerId: "synthetic", id: "foo" },
      { providerId: "synthetic", id: "bar" },
    ]);

    const notify = await check([
      model("synthetic", "foo"),
      model("synthetic", "bar"),
    ]);

    expect(notify).not.toHaveBeenCalled();
  });
});
