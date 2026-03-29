---
"@aliou/pi-ts-aperture": minor
---

Extract pure core functions from Pi glue.

Move decision-making logic into pure functions in src/core/:
- URL helpers: normalizeInputUrl, resolveGatewayUrl, resolveProviderBaseUrl
- Plan builders: buildApplyPlan, planConfigChange

All core logic is now unit-testable with no Pi dependencies.

