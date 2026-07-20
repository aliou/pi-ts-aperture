import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const APERTURE_FEATURE_REQUEST_EVENT = "aperture:feature:request";
export const APERTURE_FEATURE_REGISTER_EVENT = "aperture:feature:register";
export const APERTURE_PROXY_MODEL_SELECTED_EVENT =
  "aperture:proxy:model-selected";

export type ApertureFeatureId = "connectors";

export interface ApertureFeatureRequestPayload {
  source: "aperture";
  timestamp: string;
}

export interface ApertureFeatureRegisterPayload {
  source: "aperture";
  timestamp: string;
  feature: {
    id: ApertureFeatureId;
  };
}

export interface ApertureProxyModelSelectedPayload {
  source: "aperture";
  timestamp: string;
  selectionSource: "set" | "cycle" | "restore" | "session_start";
  model: {
    provider: string;
    id: string;
  };
}

function timestamp(): string {
  return new Date().toISOString();
}

export function createFeatureRequestPayload(): ApertureFeatureRequestPayload {
  return {
    source: "aperture",
    timestamp: timestamp(),
  };
}

export function createFeatureRegisterPayload(
  feature: ApertureFeatureId,
): ApertureFeatureRegisterPayload {
  return {
    source: "aperture",
    timestamp: timestamp(),
    feature: { id: feature },
  };
}

export function createProxyModelSelectedPayload(
  model: { provider: string; id: string },
  selectionSource: ApertureProxyModelSelectedPayload["selectionSource"],
): ApertureProxyModelSelectedPayload {
  return {
    source: "aperture",
    timestamp: timestamp(),
    selectionSource,
    model: {
      provider: model.provider,
      id: model.id,
    },
  };
}

export function emitFeatureRegister(
  pi: ExtensionAPI,
  feature: ApertureFeatureId,
): void {
  pi.events.emit(
    APERTURE_FEATURE_REGISTER_EVENT,
    createFeatureRegisterPayload(feature),
  );
}
