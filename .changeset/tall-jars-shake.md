---
"@aliou/pi-ts-aperture": minor
---

Load and run on Pi forks whose extension host differs, from one code path and with no host name sniffing.

- Parse `/api/providers` and `/api/connectors` with hand-written parsers instead of TypeBox schemas. A host may rewrite the bare `typebox` specifier onto its own adapter while leaving `typebox/value` on the real package, which silently emptied the gateway catalog; it also drops an undeclared runtime dependency.
- Register the dedicated `aperture` provider by name + config rather than as a native pi-ai `Provider`. Both hosts dispatch each model through its own `model.api`, so the custom stream hook — and its `@earendil-works/pi-ai/compat` `getApiProvider` import, which does not exist on every host — is gone.
- Proxy mode keeps its native-provider path where the host has one, and re-registers the provider by name + config where it does not, rerouting the provider's own model ids in place. Config registration merges by model id, so that branch keeps each model's own `api`, skips a passthrough provider it cannot express a credential for, warns that `keepGatewayModelsOnly` can only choose what to reroute, and contains a registration the host refuses instead of aborting the sync.

No behavior change on Pi.
