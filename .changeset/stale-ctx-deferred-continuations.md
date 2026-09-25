---
"@aliou/pi-ts-aperture": patch
---

Fix unhandled rejections and spurious extension errors when a session is replaced (`/new`, `/fork`, `/resume`, `/switch`, reload) while the gateway catalog or model refresh is still in flight. The `onSync` fire-and-forget chains in the aperture extension now terminate in a catch that drops pi's stale-ctx guard error (pi installs no `unhandledRejection` handler, so it was fatal to the process), and the connectors `session_start` handler drops the same error instead of surfacing it as an extension error. The replacement session's `session_start` re-runs the sync with a fresh ctx in both cases.
