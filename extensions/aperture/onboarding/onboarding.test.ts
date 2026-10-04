import { describe, expect, test, vi } from "vitest";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getMarkdownTheme: () => markdownTheme,
  getSettingsListTheme: () => settingsListTheme,
}));

const identity = (text: string) => text;

const markdownTheme = new Proxy(
  {},
  {
    get: () => identity,
  },
);

const settingsListTheme = {
  label: identity,
  value: identity,
  description: identity,
  cursor: "> ",
  hint: identity,
};

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: identity,
} as never;

const tui = { requestRender: () => {} } as never;

import { buildOnboardedConfig, createOnboardingWizard } from "./onboarding";

function renderWizard(wizard: ReturnType<typeof createOnboardingWizard>) {
  return wizard.render(120);
}

describe("createOnboardingWizard", () => {
  test("shows the MCP step between capabilities and the provider steps", () => {
    const wizard = createOnboardingWizard(theme, tui, () => {}, [], null);
    const rendered = renderWizard(wizard).join("\n");

    const capabilities = rendered.indexOf("Capabilities");
    const mcp = rendered.indexOf("MCP");
    const dedicated = rendered.indexOf("Dedicated");
    expect(capabilities).toBeGreaterThanOrEqual(0);
    expect(mcp).toBeGreaterThan(capabilities);
    expect(dedicated).toBeGreaterThan(mcp);
  });

  test("keeps MCP before proxy for proxy-only re-runs", () => {
    const wizard = createOnboardingWizard(theme, tui, () => {}, [], {
      baseUrl: "https://ai.pango-lin.ts.net",
      proxy: { enabled: true },
      dedicated: { enabled: false },
      mcp: { enabled: true },
    });
    const rendered = renderWizard(wizard).join("\n");

    const mcp = rendered.indexOf("MCP");
    const proxy = rendered.indexOf("Proxy");
    expect(mcp).toBeGreaterThanOrEqual(0);
    expect(proxy).toBeGreaterThan(mcp);
  });
});

describe("buildOnboardedConfig", () => {
  test("persists the mcp toggle", () => {
    const enabled = buildOnboardedConfig(
      "https://ai.pango-lin.ts.net",
      false,
      true,
      true,
      [],
      [],
    );
    expect(enabled.mcp).toEqual({ enabled: true });

    const disabled = buildOnboardedConfig(
      "https://ai.pango-lin.ts.net",
      false,
      true,
      false,
      [],
      [],
    );
    expect(disabled.mcp).toEqual({ enabled: false });
  });

  test("keeps provider routing and onboarding state intact", () => {
    const config = buildOnboardedConfig(
      "https://ai.pango-lin.ts.net",
      true,
      false,
      false,
      [{ id: "anthropic", shouldCheckGatewayModels: true }],
      [],
    );

    expect(config.proxy).toEqual({
      enabled: true,
      upstreamProviders: [
        {
          id: "anthropic",
          gatewayId: "anthropic",
          shouldCheckGatewayModels: true,
        },
      ],
    });
    expect(config.dedicated).toEqual({ enabled: false, providers: [] });
    expect(config.onboardingDone).toBe(true);
    expect(config.onboarding).toEqual({ enabled: false });
  });
});
