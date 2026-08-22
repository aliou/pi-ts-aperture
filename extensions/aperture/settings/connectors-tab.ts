import type {
  ExtraSettingsTab,
  SectionedSettingItem,
  SettingsSection,
  SettingsSubmenuContext,
  SettingsTheme,
} from "@aliou/pi-utils-settings";
import { EmptyState } from "@aliou/pi-utils-ui";
import type { Component } from "@earendil-works/pi-tui";
import type {
  ApertureConfig,
  PinnedConnectorTool,
  ResolvedConfig,
} from "../../shared/config/loader";
import {
  type ChecklistItem,
  FilterableChecklist,
} from "../shared/filterable-checklist";
import { AsyncEditor } from "./async-editor";
import {
  boolLabel,
  CONTEXT_COST_WARNING_THRESHOLD,
  GLOBAL_SCOPE,
  getTabConfig,
  listConnectorTools,
} from "./shared";

/**
 * The dynamic pinned-tools submenu content. Returned from the AsyncEditor
 * loader after fetching the live gateway tool list.
 */
interface PinnedToolsState {
  render: (width: number) => string[];
  invalidate: () => void;
  handleInput: (data: string) => void;
  /**
   * Shortcuts shown in the host panel's controls line while this submenu
   * is open. Delegates to the checklist (or reports "Esc: back" when the
   * gateway exposes no tools and only the empty state is rendered).
   */
  getShortcuts: () => string;
}

/**
 * Build the Connectors extra tab.
 *
 * Hosts the connectors-enable toggle and the pinned-tools submenu, which
 * drives the `connectors.pinnedTools` allow-list of MCP tools registered
 * as first-class Pi tools instead of via the proxy meta-tools. Pinning
 * raises per-tool context cost, so the submenu warns above a threshold.
 */
export function buildConnectorsTab(): ExtraSettingsTab<
  ApertureConfig,
  ResolvedConfig
> {
  return {
    id: "connectors",
    label: "Connectors",
    buildSections: (ctx): SettingsSection[] => {
      const draft = getTabConfig(ctx);
      const { setDraftForScope, theme: settingsTheme } = ctx;
      const baseUrl = draft.baseUrl ?? ctx.resolved.baseUrl;
      const connectorsEnabled =
        draft.connectors?.enabled ?? ctx.resolved.connectors.enabled;
      const discoveryTools =
        draft.connectors?.discoveryTools ??
        ctx.resolved.connectors.discoveryTools;
      const pinnedTools =
        draft.connectors?.pinnedTools ?? ctx.resolved.connectors.pinnedTools;

      const items: SectionedSettingItem[] = [
        {
          id: "connectors.enabled",
          label: "Connector tools",
          description: "Register MCP connector tools from Aperture",
          currentValue: boolLabel(connectorsEnabled),
          values: ["enabled", "disabled"],
        },
        {
          id: "connectors.discoveryTools",
          label: "Discovery tools",
          description: "Register list / search / describe / call meta-tools",
          currentValue: boolLabel(discoveryTools),
          values: ["enabled", "disabled"],
        },
        {
          id: "connectors.pinnedTools",
          label: "Pinned connector tools",
          description:
            "Register selected tools as first-class Pi tools (higher context cost)",
          currentValue:
            pinnedTools.length > 0 ? `${pinnedTools.length} pinned` : "none",
          submenu: (
            _val,
            submenuDone,
            submenuCtx: SettingsSubmenuContext,
          ): Component =>
            new AsyncEditor({
              requestRender: submenuCtx.requestRender,
              onCancel: () => submenuDone(undefined),
              loadingDescription: "Fetching connector tools",
              hideHint: submenuCtx.hideHint,
              loader: async (signal, loaderCtx) =>
                buildPinnedToolsEditor({
                  baseUrl,
                  draft,
                  enabledInitial: pinnedTools,
                  settingsTheme,
                  submenuDone,
                  setDraftForScope,
                  signal,
                  hideHint: loaderCtx.hideHint,
                }),
            }),
        },
      ];

      return [{ label: "Connectors", items }];
    },
    onSettingChange: (id, newValue, tabCtx) => {
      tabCtx.applySettingChangeToScope(GLOBAL_SCOPE, id, newValue);
    },
  };
}

interface PinnedToolsEditorOptions {
  baseUrl: string;
  draft: ApertureConfig;
  enabledInitial: PinnedConnectorTool[];
  settingsTheme: SettingsTheme;
  submenuDone: (summary?: string) => void;
  setDraftForScope: (
    scope: typeof GLOBAL_SCOPE,
    config: ApertureConfig,
  ) => void;
  /** Abort signal from the AsyncEditor; aborts the in-flight fetch on Esc. */
  signal?: AbortSignal;
  /**
   * Forwarded from the AsyncEditor loader context: when the host panel
   * renders the controls line, the checklist and empty state suppress
   * their own footer hints (shortcuts are exposed via `getShortcuts`).
   */
  hideHint?: boolean;
}

/**
 * Derive the connector id for a gateway tool name.
 *
 * Matches the prefix grouping used by the connectors extension: the segment
 * before the first `_`. Tools without an underscore fall back to "other".
 */
function connectorIdFromToolName(name: string): string {
  const idx = name.indexOf("_");
  return idx > 0 ? name.slice(0, idx) : "other";
}

async function buildPinnedToolsEditor(
  options: PinnedToolsEditorOptions,
): Promise<PinnedToolsState> {
  const {
    baseUrl,
    draft,
    enabledInitial,
    settingsTheme,
    submenuDone,
    setDraftForScope,
    signal,
    hideHint = false,
  } = options;

  const tools = await listConnectorTools(baseUrl, signal);
  // De-dupe (gateway may return the same name from multiple
  // connectors) and preserve gateway order.
  const seen = new Set<string>();
  const uniqueTools = tools.filter((t) => {
    if (seen.has(t.name)) return false;
    seen.add(t.name);
    return true;
  });
  const enabled = new Set(enabledInitial.map((p) => p.toolName));

  const summary = () =>
    uniqueTools.length > 0
      ? `${enabled.size}/${uniqueTools.length} pinned`
      : "none";

  const writeDraft = () => {
    const updated = structuredClone(draft) as ApertureConfig;
    updated.connectors = {
      ...updated.connectors,
      pinnedTools: uniqueTools
        .filter((t) => enabled.has(t.name))
        .map((t) => ({
          connectorId: connectorIdFromToolName(t.name),
          toolName: t.name,
        })),
    };
    setDraftForScope(GLOBAL_SCOPE, updated);
  };

  const buildItems = (): ChecklistItem[] =>
    uniqueTools.map((t) => ({
      id: t.name,
      label: t.name,
      checked: enabled.has(t.name),
    }));

  const checklist = new FilterableChecklist(
    settingsTheme,
    buildItems(),
    (id) => {
      if (enabled.has(id)) enabled.delete(id);
      else enabled.add(id);
      writeDraft();
      checklist.updateItems(buildItems());
    },
    undefined,
    () => submenuDone(summary()),
    hideHint,
  );

  const emptyState = new EmptyState({
    title: "No connector tools found",
    description: "Connectors on the Aperture gateway expose no tools yet.",
    titleStyle: (t: string) => settingsTheme.label(t, false),
    descriptionStyle: (t: string) => settingsTheme.hint(t),
    padding: 1,
  });

  return {
    render(width: number) {
      const count = enabled.size;
      const warn = count > CONTEXT_COST_WARNING_THRESHOLD;
      const title = ` Pinned Connector Tools (${count}/${uniqueTools.length})${
        warn ? " — high context cost" : ""
      }`;
      const lines = [settingsTheme.label(title, true), ""];
      if (uniqueTools.length === 0) {
        lines.push(...emptyState.render(width));
        if (!hideHint) {
          lines.push(settingsTheme.hint("  Esc: back"));
        }
        return lines;
      }
      if (warn) {
        checklist.setExtraHint(
          "Each pinned tool adds its full schema to the system prompt.",
        );
      } else {
        checklist.setExtraHint("");
      }
      lines.push(...checklist.render(width));
      return lines;
    },
    invalidate() {
      checklist.invalidate();
      emptyState.invalidate();
    },
    handleInput(data: string) {
      checklist.handleInput(data);
    },
    getShortcuts() {
      return uniqueTools.length === 0 ? "Esc: back" : checklist.getShortcuts();
    },
  };
}
