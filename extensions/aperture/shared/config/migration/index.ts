import { legacyToV06Migration } from "./001-legacy-to-v0-6";
import { modeToCapabilitiesMigration } from "./002-mode-to-capabilities";
import { normalizeCapabilitiesMigration } from "./003-normalize-capabilities";

export const migrations = [
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  normalizeCapabilitiesMigration,
];

export {
  legacyToV06Migration,
  modeToCapabilitiesMigration,
  normalizeCapabilitiesMigration,
};
