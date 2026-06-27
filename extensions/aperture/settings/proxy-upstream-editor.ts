import type { SettingsTheme } from "@aliou/pi-utils-settings";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Component } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { ApertureProvider } from "../../../src/api/types";
import { mapProxyProviders } from "../../../src/provider-mapping";
import type { ProxiedProviderConfig } from "../../../src/shared/config/loader";
import {
  type ChecklistItem,
  FilterableChecklist,
} from "../shared/filterable-checklist";

/**
 * A proxied-provider entry as the editor persists it. `shouldCheckGatewayModels`
 * is always set (the editor defaults it to `true`), so onboarding state and the
 * config draft both receive a fully-formed entry. Assignable to
 * {@link ProxiedProviderConfig}.
 */
export interface PersistedProxiedProvider {
  id: string;
  apertureProviderId?: string;
  shouldCheckGatewayModels: boolean;
}

/**
 * One row in the upstream-providers editor: a local Pi provider and the
 * Aperture gateway provider it maps to (if any). `apertureProviderId` is
 * `undefined` when the Pi provider has no mapping yet — the row is an
 * unmapped candidate the user can configure.
 */
export interface MappingEntry {
  /** Pi provider id (routing key). */
  id: string;
  /** Aperture gateway provider id this Pi provider maps to. `undefined` = unmapped. */
  apertureProviderId?: string;
  /** Display name resolved from the Aperture gateway provider, if known. */
  apertureName?: string;
  /** `true` when automatic matching would include this provider. */
  automatic: boolean;
  /** `false` when the Pi provider no longer exists in the local registry. */
  existsLocally: boolean;
  /** Whether this provider is in `upstreamProviders` (proxied). */
  enabled: boolean;
  /** Whether the gateway model check is enabled for this mapping. */
  shouldCheckGatewayModels: boolean;
}

/** Sentinel id for the "clear mapping" row in the Aperture picker. */
const CLEAR_MAPPING_ID = "__clear__";

/**
 * Build editor rows for EVERY local Pi provider (excluding `aperture`):
 * matched providers (from {@link mapProxyProviders}, auto + persisted manual)
 * plus unmatched local providers as unmapped candidate rows. This is what
 * makes `anthropic` / `openai-codex` visible even when the Aperture gateway
 * names its providers differently and (for non-admins) `/aperture/config` is
 * unavailable.
 */
export function buildProxyRows(
  localModels: readonly Model<Api>[],
  gatewayProviders: ApertureProvider[],
  providerInfos: Parameters<typeof mapProxyProviders>[1],
  upstreamProviders: readonly ProxiedProviderConfig[],
  autoMatchUnavailable = false,
): { entries: MappingEntry[]; autoMatchUnavailable: boolean } {
  const mapping = mapProxyProviders(
    localModels,
    providerInfos,
    gatewayProviders,
    [...upstreamProviders],
  );
  const enabledIds = new Set(upstreamProviders.map((p) => p.id));
  const matchedIds = new Set(mapping.map((m) => m.id));

  const entries: MappingEntry[] = mapping.map((m) => ({
    id: m.id,
    apertureProviderId: m.apertureProviderId,
    apertureName: m.name,
    automatic: m.matchedAutomatically,
    existsLocally: m.existsLocally,
    enabled: enabledIds.has(m.id),
    shouldCheckGatewayModels: m.shouldCheckGatewayModels,
  }));

  // Append unmatched local providers as unmapped candidate rows so they are
  // visible and configurable even with zero auto-matches.
  const localIds = new Set<string>();
  for (const model of localModels) {
    if (model.provider === "aperture") continue;
    if (matchedIds.has(model.provider)) continue;
    localIds.add(model.provider);
  }
  for (const id of localIds) {
    entries.push({
      id,
      apertureProviderId: undefined,
      apertureName: undefined,
      automatic: false,
      existsLocally: true,
      enabled: false,
      shouldCheckGatewayModels: true,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, autoMatchUnavailable };
}

export interface ProxyUpstreamProvidersEditorOptions {
  theme: SettingsTheme;
  requestRender: () => void;
  /** Called when the user leaves the editor (Esc in settings; Enter in onboarding list mode). */
  onDone: (summary?: string) => void;
  /** Aperture gateway providers from `/api/providers`, for the target picker. */
  gatewayProviders: ApertureProvider[];
  /** All local Pi providers as rows (use {@link buildProxyRows}). */
  entries: MappingEntry[];
  /** `true` when automatic base-URL matching was unavailable (non-admin 403). */
  autoMatchUnavailable?: boolean;
  /** Persist the enabled mappings into config/onboarding state. */
  persist: (upstreamProviders: PersistedProxiedProvider[]) => void;
  /** Tailors hint text. `settings` shows Esc=back; `onboarding` shows Enter=continue. */
  context?: "settings" | "onboarding";
}

type Mode = "list" | "pickAperture";

/**
 * Editor for `proxy.upstreamProviders`.
 *
 * Both the provider list and the Aperture target picker are searchable
 * `FilterableChecklist`s (search input + list, type to filter) so the keyboard
 * never has to choose between "type a letter to filter" and "letter as a
 * hotkey" — there are NO letter hotkeys here. That is what makes this component
 * usable with both short and long provider lists, and for non-admin grants that
 * must map providers like `anthropic` by hand.
 *
 * Keys in the provider list: type to filter · `↑↓` navigate · `Space` set /
 * change the Aperture target (opens the target picker; for an unmapped row this
 * also enables it) · `Ctrl+G` toggle the gateway model check for the
 * highlighted row · `Esc` back (settings) / `Enter` continue (onboarding, list
 * mode only).
 *
 * Keys in the target picker: type to filter · `↑↓` navigate · `Space` select
 * the highlighted Aperture provider (or the "clear mapping" row, shown only when
 * re-pointing) · `Esc` back to the list.
 *
 * There is no separate `enabled` flag in the config (yet), so disabling a
 * mapping removes it from `upstreamProviders`. Auto-matched providers are
 * re-derived on the next open; a disabled manual mapping is lost — re-add it.
 */
export class ProxyUpstreamProvidersEditor implements Component {
  private readonly theme: SettingsTheme;
  private readonly requestRender: () => void;
  private readonly onDone: (summary?: string) => void;
  private readonly gatewayProviders: ApertureProvider[];
  private readonly persistFn: (
    upstreamProviders: PersistedProxiedProvider[],
  ) => void;
  private readonly context: "settings" | "onboarding";

  private entries: MappingEntry[];
  private mode: Mode = "list";

  // The active FilterableChecklist for the current mode (recreated on each
  // render via updateItems so it reflects live state).
  private listChecklist: FilterableChecklist | null = null;
  private pickerChecklist: FilterableChecklist | null = null;

  // Row being mapped/re-pointed in the target picker.
  private pickingForId: string | null = null;

  constructor(options: ProxyUpstreamProvidersEditorOptions) {
    this.theme = options.theme;
    this.requestRender = options.requestRender;
    this.onDone = options.onDone;
    this.gatewayProviders = options.gatewayProviders;
    this.persistFn = options.persist;
    this.context = options.context ?? "settings";
    this.entries = options.entries;
  }

  invalidate(): void {
    this.listChecklist?.invalidate();
    this.pickerChecklist?.invalidate();
  }

  /** `true` when the editor is in the main list (not the target picker). */
  isListMode(): boolean {
    return this.mode === "list";
  }

  // --- persistence ---

  private persist(): void {
    const upstreamProviders: PersistedProxiedProvider[] = this.entries
      .filter((e) => e.enabled && e.apertureProviderId)
      .map((e) => ({
        id: e.id,
        apertureProviderId: e.apertureProviderId,
        shouldCheckGatewayModels: e.shouldCheckGatewayModels,
      }));
    this.persistFn(upstreamProviders);
    this.requestRender();
  }

  private doneSummary(): string {
    const enabledCount = this.entries.filter((e) => e.enabled).length;
    const mappedCount = this.entries.filter((e) => e.apertureProviderId).length;
    return mappedCount > 0
      ? `${enabledCount}/${mappedCount} mapped enabled`
      : "none";
  }

  // --- row labels ---

  private rowLabel(entry: MappingEntry): string {
    const target = entry.apertureName ?? entry.apertureProviderId;
    const targetLabel = target ?? "unmapped";
    const arrow =
      entry.apertureProviderId && entry.id === entry.apertureProviderId
        ? targetLabel
        : `${entry.id} -> ${targetLabel}`;
    const originTag = entry.apertureProviderId
      ? entry.automatic
        ? " [auto]"
        : " [manual]"
      : "";
    const stale = entry.existsLocally ? "" : " (local provider missing)";
    return `${arrow}${originTag}${stale}`;
  }

  private buildListItems(): ChecklistItem[] {
    return this.entries.map((entry) => ({
      id: entry.id,
      label: this.rowLabel(entry),
      checked: entry.enabled,
    }));
  }

  private buildPickerItems(): ChecklistItem[] {
    const entry = this.entries.find((e) => e.id === this.pickingForId);
    const items: ChecklistItem[] = this.gatewayProviders.map((provider) => ({
      id: provider.id,
      label: `${provider.name ?? provider.id} (${provider.id}) · ${provider.models.length} models${
        provider.id === entry?.apertureProviderId ? " — current" : ""
      }`,
      checked: false,
    }));
    // When re-pointing an existing mapping, offer a "clear" option at the top.
    if (entry?.apertureProviderId) {
      items.unshift({
        id: CLEAR_MAPPING_ID,
        label: "— Clear mapping —",
        checked: false,
      });
    }
    return items;
  }

  // --- rendering ---

  render(width: number): string[] {
    if (this.mode === "pickAperture") return this.renderAperturePicker(width);
    return this.renderList(width);
  }

  private renderList(width: number): string[] {
    const lines: string[] = [];
    const enabledCount = this.entries.filter((e) => e.enabled).length;
    lines.push(
      this.theme.label(
        ` Upstream Providers (${enabledCount} enabled / ${this.entries.length})`,
        true,
      ),
    );
    lines.push("");

    if (this.entries.length === 0) {
      lines.push(this.theme.hint("  No local Pi providers found."));
      lines.push("");
      lines.push(this.theme.hint("  Esc: back"));
      return lines;
    }

    if (!this.listChecklist) {
      // Onboarding's wizard intercepts Esc (cancel) before the step, so
      // Esc-as-back only works in settings — there, onClose runs onDone. In
      // onboarding, Enter (handled in handleInput) advances the step.
      const onClose =
        this.context === "settings"
          ? () => this.onDone(this.doneSummary())
          : undefined;
      this.listChecklist = new FilterableChecklist(
        this.theme,
        this.buildListItems(),
        (id) => this.activateRow(id),
        (id) => this.toggleGatewayCheckFor(id),
        onClose,
      );
    } else {
      this.listChecklist.updateItems(this.buildListItems());
    }

    const backHint =
      this.context === "onboarding" ? "Enter: continue" : "Esc: back";
    this.listChecklist.setHint(
      `Space: set/change target · Ctrl+G: gateway check · ${backHint}`,
    );

    return [...lines, ...this.listChecklist.render(width)];
  }

  private renderAperturePicker(width: number): string[] {
    const lines: string[] = [];
    const entry = this.entries.find((e) => e.id === this.pickingForId);
    const action = entry?.apertureProviderId ? "Change target for" : "Map";
    lines.push(
      this.theme.label(
        ` ${action} ${this.pickingForId ?? ""}: choose Aperture provider`,
        true,
      ),
    );
    lines.push("");

    if (this.gatewayProviders.length === 0) {
      lines.push(this.theme.hint("  No Aperture providers available."));
      lines.push("");
      lines.push(this.theme.hint("  Esc: back"));
      return lines;
    }

    if (!this.pickerChecklist) {
      // Same Esc constraint as the list: settings uses Esc-to-back; onboarding
      // uses Enter (handled in handleInput) since the wizard eats Esc.
      const onClose =
        this.context === "settings" ? () => this.exitPicker() : undefined;
      this.pickerChecklist = new FilterableChecklist(
        this.theme,
        this.buildPickerItems(),
        (id) => this.confirmAperturePick(id),
        undefined,
        onClose,
      );
    } else {
      this.pickerChecklist.updateItems(this.buildPickerItems());
    }
    const pickerBackHint =
      this.context === "onboarding" ? "Enter: back" : "Esc: back";
    this.pickerChecklist.setHint(`Space: select · ${pickerBackHint}`);

    return [...lines, ...this.pickerChecklist.render(width)];
  }

  // --- input ---

  handleInput(data: string): void {
    if (this.mode === "pickAperture") {
      // Onboarding's wizard intercepts Esc before the step, so the picker
      // cannot use Esc to go back there. Enter backs out of the picker instead.
      if (this.context === "onboarding" && matchesKey(data, Key.enter)) {
        this.exitPicker();
        return;
      }
      this.pickerChecklist?.handleInput(data);
      return;
    }
    // List mode: in onboarding, Enter advances the step (Esc is eaten by the
    // wizard). In settings, Esc backs out via the list checklist's onClose.
    if (this.context === "onboarding" && matchesKey(data, Key.enter)) {
      this.onDone(this.doneSummary());
      return;
    }
    this.listChecklist?.handleInput(data);
  }

  // --- actions ---

  /** Space on a row: open the target picker to set/change its Aperture provider. */
  private activateRow(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) return;
    if (this.gatewayProviders.length === 0) {
      this.requestRender();
      return;
    }
    this.pickingForId = entry.id;
    this.pickerChecklist = null; // rebuild for this row
    this.mode = "pickAperture";
    this.requestRender();
  }

  private confirmAperturePick(pickedId: string): void {
    const entry = this.entries.find((e) => e.id === this.pickingForId);
    if (!entry) {
      this.exitPicker();
      return;
    }
    if (pickedId === CLEAR_MAPPING_ID) {
      entry.apertureProviderId = undefined;
      entry.apertureName = undefined;
      entry.automatic = false;
      entry.enabled = false;
    } else {
      const provider = this.gatewayProviders.find((p) => p.id === pickedId);
      if (!provider) {
        this.exitPicker();
        return;
      }
      entry.apertureProviderId = provider.id;
      entry.apertureName = provider.name ?? provider.id;
      entry.automatic = false; // explicit choice overrides any auto match
      entry.enabled = true;
    }
    this.exitPicker();
    this.persist();
  }

  private exitPicker(): void {
    this.pickingForId = null;
    this.pickerChecklist = null;
    this.mode = "list";
    this.requestRender();
  }

  private toggleGatewayCheckFor(id: string): void {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry?.apertureProviderId) return;
    entry.shouldCheckGatewayModels = !entry.shouldCheckGatewayModels;
    this.persist();
  }
}
