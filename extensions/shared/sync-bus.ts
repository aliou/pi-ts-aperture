import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const APERTURE_CONFIG_SYNC_EVENT = "aperture:config:sync";

export function onConfigSync(pi: ExtensionAPI, cb: () => void): () => void {
  return pi.events.on(APERTURE_CONFIG_SYNC_EVENT, cb);
}

export function emitConfigSync(pi: ExtensionAPI): void {
  pi.events.emit(APERTURE_CONFIG_SYNC_EVENT, {});
}
