---
"@aliou/pi-ts-aperture": minor
---

Route classifier models through the gateway: the `/v1/models` catalog now advertises per-model endpoints (shaped by `model_compatibility` in the Aperture config), so a model served only over `/v1/systemone` is exposed as a classifier on the dedicated `aperture` provider and never as a chat model; dual-protocol models stay chat models. The dedicated provider gains `getAllModels` plus a `classify` entry point backed by a re-implemented System One client, the proxy wrapper rewrites classifier models to the gateway base URL while keeping their `api`, and registry snapshots include classifier models. The catalog key bumps to v3 so pre-classifier caches are never replayed.
