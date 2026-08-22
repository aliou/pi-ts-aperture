type SyncCallback = () => void;

const listeners = new Set<SyncCallback>();

export function onConfigSync(cb: SyncCallback): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitConfigSync(): void {
  for (const listener of listeners) listener();
}
