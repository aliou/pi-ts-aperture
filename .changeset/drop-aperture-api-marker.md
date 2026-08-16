---
"@aliou/pi-ts-aperture": patch
---

Drop the custom `aperture` API marker from dedicated models. Models now carry their real upstream Pi API (from gateway compatibility), so they get API-correct option shaping — reasoning effort mapping, sampling params — instead of the generic defaults the unknown marker produced. Legacy models-store snapshots stamped with the marker still restore.
