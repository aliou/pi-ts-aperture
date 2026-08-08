---
"@aliou/pi-ts-aperture": patch
---

Adopt `@aliou/pi-utils-settings` 0.19.1.

- Bumped dependency to `^0.19.1`.
- Added semver `version` fields (`0.6.0`, `0.7.0`, `0.8.0`) to the three content-gated migrations.
- Switched `gen:schema` and `check:schema` scripts to the new `pi-settings-schema` CLI, which injects `$schema` and `version` into `schema.json`.
- Regenerated `schema.json` with the CLI-injected reserved properties.
