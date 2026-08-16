---
"@aliou/pi-ts-aperture": minor
---

Native pi-ai provider registration for both modes, and a proxy-mode routing fix.

Proxy mode: requests for extension-native providers (synthetic, neuralwatt) now go through the Aperture gateway. Sync previously re-registered providers via the name-plus-config path, which deletes the extension-native provider entry from pi's model runtime; with no base provider left, model baseUrls were never rewritten to the gateway, so requests hit upstream APIs with no credentials and 401'd. Sync now wraps the live provider (gateway baseUrls, placeholder key for anonymous providers) and re-registers it through the native path.

Dedicated mode: the `aperture` provider is now registered as a pi-ai `Provider`, mirroring pi-synthetic and pi-neuralwatt. The provider owns its auth (gateway-authenticated: resolve always succeeds with a placeholder key, check always reports configured), owns its live model list (adopted via `context.publish`), and gains full `stream` dispatch alongside `streamSimple`.

Peers now require pi >= 0.84; the pre/post-0.84 store shim is deleted.
