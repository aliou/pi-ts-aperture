---
"@aliou/pi-ts-aperture": patch
---

Let Pi auto-retry transient gateway failures. "aperture is restarting, retry this request" is now tagged in a `message_end` handler so Pi's retry classifier picks it up instead of failing the turn. Works in both dedicated and proxy mode.
