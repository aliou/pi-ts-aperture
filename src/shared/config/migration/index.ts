import { legacyToV06Migration } from "./001-legacy-to-v0-6";
import { modeToCapabilitiesMigration } from "./002-mode-to-capabilities";
import { normalizeCapabilitiesMigration } from "./003-normalize-capabilities";
import { proxyProviderApertureIdMigration } from "./004-proxy-provider-aperture-id";

export const migrations = [
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  normalizeCapabilitiesMigration,
  proxyProviderApertureIdMigration,
];

export {
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  normalizeCapabilitiesMigration,
  proxyProviderApertureIdMigration,
};
