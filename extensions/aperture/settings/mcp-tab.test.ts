import { describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../shared/config/defaults";
import type { ApertureConfig } from "../../shared/config/loader";
import { buildMcpTab } from "./mcp-tab";

function buildSections(draft?: ApertureConfig) {
  return buildMcpTab().buildSections({
    resolved: DEFAULT_CONFIG,
    getDraftForScope: () => draft ?? null,
    getRawForScope: () => null,
  } as never);
}

describe("mcp settings tab", () => {
  test("exposes only the enable toggle and a pi-native pointer row", () => {
    const sections = buildSections();

    expect(sections).toHaveLength(1);
    const items = sections[0].items;
    expect(items.map((i) => i.id)).toEqual(["mcp.enabled", "mcp.manage"]);
    expect(items[0].values).toEqual(["enabled", "disabled"]);
    expect(items[1].values).toBeUndefined();
    expect(items[1].submenu).toBeUndefined();
  });

  test("reflects the enabled state from the draft, then resolved config", () => {
    expect(buildSections()[0].items[0].currentValue).toBe("disabled");
    expect(
      buildSections({ mcp: { enabled: true } })[0].items[0].currentValue,
    ).toBe("enabled");
  });

  test("routes toggle changes to the global scope", () => {
    const applySettingChangeToScope = vi.fn();
    buildMcpTab().onSettingChange("mcp.enabled", "enabled", {
      applySettingChangeToScope,
    } as never);

    expect(applySettingChangeToScope).toHaveBeenCalledWith(
      "global",
      "mcp.enabled",
      "enabled",
    );
  });
});
