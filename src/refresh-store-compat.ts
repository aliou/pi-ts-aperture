// ---------------------------------------------------------------------------
// Backward-compat shim for the Pi coding-agent provider refresh context.
//
// Pi 0.84 replaced dynamic `context.store` read/write access with the
// read-only `context.stored` snapshot and the generation-checked
// `context.publish({ persist })` transaction. This module detects the
// available API shape at runtime so the extension works on both <0.84 (store)
// and >=0.84 (publish) hosts.
//
// Once the minimum supported @earendil-works/pi-coding-agent version is
// >=0.84, delete this file and:
//   - replace `readStoredModels(context)` with `context.stored`
//   - replace `persistModels(context, entry)` with
//     `await context.publish({ persist: entry })` (skip when aborted)
// ---------------------------------------------------------------------------

import type {
  ModelsStoreEntry,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";

type LegacyRefreshModelsContext = RefreshModelsContext & {
  store?: {
    read(): Promise<ModelsStoreEntry | undefined>;
    write(entry: ModelsStoreEntry): Promise<unknown>;
  };
};

/**
 * Returns the persisted catalog entry for the current provider, reading from
 * the 0.84+ `context.stored` snapshot when available and falling back to the
 * legacy `context.store.read()` on older hosts.
 */
export async function readStoredModels(
  context: RefreshModelsContext,
): Promise<ModelsStoreEntry | undefined> {
  if (context.stored !== undefined) return context.stored;
  return readLegacyStore(context);
}

function readLegacyStore(
  context: RefreshModelsContext,
): Promise<ModelsStoreEntry | undefined> {
  const legacy = context as LegacyRefreshModelsContext;
  return legacy.store ? legacy.store.read() : Promise.resolve(undefined);
}

/**
 * Persists the catalog entry, publishing through
 * `context.publish({ persist: entry })` on 0.84+ hosts and writing through
 * the legacy `context.store.write(entry)` on older hosts.
 *
 * Returns true when the entry was persisted. On 0.84+ hosts a return value of
 * false means a newer refresh superseded this publication (generation check).
 */
export async function persistModels(
  context: RefreshModelsContext,
  entry: ModelsStoreEntry,
): Promise<boolean> {
  if (typeof context.publish === "function") {
    return context.publish({ persist: entry });
  }
  const legacy = context as LegacyRefreshModelsContext;
  if (legacy.store) {
    await legacy.store.write(entry);
    return true;
  }
  return false;
}
