---
"@aliou/pi-ts-aperture": patch
---

Fix a crash when another extension replaces the session at startup (`ctx.newSession()` via pi-rig's `/spawn --parent`) while the gateway catalog fetch in `proxyRuntime.sync()` / `checkMissingModels()` is still in flight. Pi invalidates the ctx after `session_shutdown`, so every deferred continuation on the stale ctx threw `This extension ctx is stale after session replacement or reload.` and took down the process. Sync continuations now check an `invalidated` flag set by `session_shutdown` and bail; the replacement session's `session_start` re-runs the sync with a fresh ctx.
