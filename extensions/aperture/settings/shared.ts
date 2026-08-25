import type {
  ExtraSettingsTabContext,
  Scope,
  SettingsDetailField,
} from "@aliou/pi-utils-settings";
import type { ProviderCompatibility } from "../../../src/api/types";
import { createMcpSession, type McpTool } from "../../../src/mcp-client";
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
 * Above this many pinned tools, the submodule title warns about the system
 * prompt cost. Each pinned tool contributes its full JSON Schema to the
 * prompt; the proxy meta-tools exist precisely to keep that cost down.
 */
export const CONTEXT_COST_WARNING_THRESHOLD = 10;

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
 * Fetch the current connector tool list from the Aperture gateway.
 *
 * Used by the pinned-tools submenu so it always reflects live gateway
 * state rather than the cached set from the last session_start.
 */
export async function listConnectorTools(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<McpTool[]> {
  const session = await createMcpSession(baseUrl, signal);
  return session.listTools(signal);
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
