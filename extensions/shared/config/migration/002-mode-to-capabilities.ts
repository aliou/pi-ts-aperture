import type { ApertureConfig, Migration } from "../types";
import type { LegacyApertureConfig } from "./legacy";

export const modeToCapabilitiesMigration: Migration<ApertureConfig> = {
  name: "002-mode-to-capabilities",
  version: "0.7.0",
  shouldRun: (config) => (config as LegacyApertureConfig).mode !== undefined,
  run: (config) => {
    const migrated = { ...config } as LegacyApertureConfig;

    if (migrated.mode === "proxy") {
      migrated.proxy = { ...migrated.proxy, enabled: true };
      migrated.dedicated = { ...migrated.dedicated, enabled: false };
    } else if (migrated.mode === "dedicated") {
      migrated.dedicated = { ...migrated.dedicated, enabled: true };
      migrated.proxy = { ...migrated.proxy, enabled: false };
    }

    delete migrated.mode;
    return migrated satisfies ApertureConfig;
  },
};
