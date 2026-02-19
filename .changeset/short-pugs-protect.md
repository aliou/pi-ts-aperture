---
"@aliou/pi-ts-aperture": minor
---

Improve `/aperture:setup` provider and connectivity flow.

- Add URL health check during setup (`/v1/models`) before provider selection, with retry/cancel UX.
- Build provider choices from Pi's runtime model registry so extension-registered providers (for example `pi-synthetic`) appear in the setup list.
