import type {
  ExtraSettingsTabContext,
  Scope,
  SettingsDetailField,
} from "@aliou/pi-utils-settings";
import type { ProviderCompatibility } from "../../../src/api/types";
import {
  getApiForCompatibility,
  getSelectableApis,
} from "../../shared/api-selection";
import type {
  ApertureConfig,
  ResolvedConfig,
  RoutableApi,
} from "../../shared/config/loader";

/**
 * Aperture is a network-level concern: config is global only.
 * Each extra tab routes its value-cycling items to the global scope draft.
 */
export const GLOBAL_SCOPE: Scope = "global";

/**
 * Fixed content height (lines) of the settings panel body. Passed to
 * `registerSettingsCommand` and to every `SettingsDetailEditor` built by
 * the tabs so submenus bottom-anchor descriptions inside the same budget
 * instead of leaving a floating description above a blank gap. Matches
 * the library default (20); defined once here so the command and the
 * editors cannot drift apart.
 */
export const SETTINGS_CONTENT_HEIGHT = 20;

export function boolLabel(value: boolean): string {
  return value ? "enabled" : "disabled";
}

/** Enum field for a provider's api override; auto shows the API it resolves to. Null when the gateway maps no API. */
export function apiSelectionField(options: {
  id: string;
  compatibility: ProviderCompatibility | undefined;
  getValue: () => RoutableApi | undefined;
  setValue: (value: RoutableApi | undefined) => void;
}): SettingsDetailField | null {
  const selectableApis = getSelectableApis(options.compatibility);
  if (selectableApis.length === 0) return null;
  const resolved = getApiForCompatibility(options.compatibility);
  const autoOption = `auto (${resolved})`;
  return {
    type: "enum",
    id: options.id,
    label: "API",
    description: `Pi API this provider's models route through. Auto picks ${resolved} from the gateway's compatibility map.`,
    options: [autoOption, ...selectableApis],
    getValue: () => options.getValue() ?? autoOption,
    setValue: (value) =>
      options.setValue(
        value === autoOption ? undefined : (value as RoutableApi),
      ),
  };
}

/** Row summary for a provider entry, e.g. `enabled · anthropic-messages`. */
export function providerSummary(
  enabled: boolean,
  api: RoutableApi | undefined,
): string {
  if (!enabled) return "disabled";
  return api ? `enabled · ${api}` : "enabled";
}

/**
 * Read the effective config for an extra tab.
 *
 * Aperture extra tabs are not scope-bound, but config is global-only, so
 * every extra tab operates on the global draft (or the raw on-disk value
 * when the user has not made any change yet).
 */
export function getTabConfig(
  ctx: Pick<
    ExtraSettingsTabContext<ApertureConfig, ResolvedConfig>,
    "getDraftForScope" | "getRawForScope" | "resolved"
  >,
): ApertureConfig {
  return (
    ctx.getDraftForScope(GLOBAL_SCOPE) ??
    ctx.getRawForScope(GLOBAL_SCOPE) ?? {
      ...(ctx.resolved as unknown as ApertureConfig),
    }
  );
}
