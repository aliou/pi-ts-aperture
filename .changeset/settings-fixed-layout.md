---
"@aliou/pi-ts-aperture": patch
---

Bump @aliou/pi-utils-settings to ^0.20.0 and adopt the fixed-height settings layout: `/aperture:settings` renders at a fixed content height (`SETTINGS_CONTENT_HEIGHT` in `settings/shared.ts`), detail editors bottom-anchor their descriptions inside the same budget, and submenus forward `hideHint` / expose `getShortcuts()` so the panel's single controls line always shows the open submenu's shortcuts. Onboarding wizards render unchanged.
