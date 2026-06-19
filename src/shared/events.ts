import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const APERTURE_FEATURE_REQUEST_EVENT = "aperture:feature:request";
export const APERTURE_FEATURE_REGISTER_EVENT = "aperture:feature:register";

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

export function emitFeatureRegister(
  pi: ExtensionAPI,
  feature: ApertureFeatureId,
): void {
  pi.events.emit(
    APERTURE_FEATURE_REGISTER_EVENT,
    createFeatureRegisterPayload(feature),
  );
}
