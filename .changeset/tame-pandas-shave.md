---
"@aliou/pi-ts-aperture": patch
---

Proxy mode: strip the transport-qualified provider prefix from the persisted assistant message model id in the `message_end` handler, so resuming a session restores the model via the bare registry id instead of warning "Could not restore model ..." and falling back to a default model. The strip is idempotent: already-bare ids are left untouched.
