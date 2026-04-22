---
"@aliou/pi-ts-aperture": major
---

Rewrite extension architecture. Moves core logic to `src/lib/`, introduces `ApertureRuntime` class with dependency injection, replaces lifecycle hooks with `session_start` + `onSync` callback pattern, and adds provider unregistration with user notification.
