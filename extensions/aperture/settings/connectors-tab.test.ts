import { describe, expect, test, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../shared/config/defaults";
import type { ApertureConfig } from "../../shared/config/loader";
import { buildConnectorsTab } from "./connectors-tab";

function buildSections(draft?: ApertureConfig) {
  return buildConnectorsTab().buildSections({
    resolved: DEFAULT_CONFIG,
    getDraftForScope: () => draft ?? null,
    getRawForScope: () => null,
  } as never);
}

describe("connectors settings tab", () => {
  test("exposes only the enable toggle and a pi-native pointer row", () => {
    const sections = buildSections();

    expect(sections).toHaveLength(1);
    const items = sections[0].items;
    expect(items.map((i) => i.id)).toEqual([
      "connectors.enabled",
      "connectors.manage",
    ]);
    expect(items[0].values).toEqual(["enabled", "disabled"]);
    // The pointer row is read-only: no values to cycle, no submenu.
    expect(items[1].values).toBeUndefined();
    expect(items[1].submenu).toBeUndefined();
  });

  test("reflects the enabled state from the draft, then resolved config", () => {
    expect(buildSections()[0].items[0].currentValue).toBe("disabled");
    expect(
      buildSections({ connectors: { enabled: true } })[0].items[0].currentValue,
    ).toBe("enabled");
  });

  test("routes toggle changes to the global scope", () => {
    const applySettingChangeToScope = vi.fn();
    buildConnectorsTab().onSettingChange("connectors.enabled", "enabled", {
      applySettingChangeToScope,
    } as never);

    expect(applySettingChangeToScope).toHaveBeenCalledWith(
      "global",
      "connectors.enabled",
      "enabled",
    );
  });
});
