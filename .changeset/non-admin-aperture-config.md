---
"@aliou/pi-ts-aperture": patch
---

Tolerate the admin-only `/aperture/config` endpoint so non-admin Aperture grants can use the extension.

- `ApertureClient._fetch` now throws an `ApertureHttpError` that carries the HTTP status, so callers can tolerate specific responses.
- `providerConfigInfos()` (and `providerBaseUrls()`) return an empty map on HTTP 403 instead of throwing. `/aperture/config` requires `role:admin` and is the only endpoint a non-admin grant cannot access; everything else (`/api/providers`, `/api/connectors`, `/v1/mcp`, model calls) returns 200 for non-admin grants.
- Proxy provider matching already falls back to IDs via `/api/providers` when provider config info is empty, so onboarding and the proxy settings submenu keep working for non-admin users. Admin users keep the richer base-URL matching. Dedicated mode and connectors never read `/aperture/config` and are unaffected.
- Other non-403 errors still propagate.
