---
"@aliou/pi-ts-aperture": minor
---

Expose decision models as `openai-decisions` classifiers on the dedicated `aperture` provider:

- Models serving `/v1/decisions` keep their chat entry and gain a decisions classifier alongside it (for example `openai-api/gpt-6-luna` on the QA gateway), callable via `models.classify` with no consumer-side wrapping.
- Classification dispatch moves from a hardcoded System One call to a `classifierApis` injection, and emission is gated on the injected implementations, so the dedicated provider never lists a classifier it cannot dispatch.
- The System One and OpenAI Decisions classifier clients live in `src/system-one.ts` and `src/openai-decisions.ts`, shared by the extension and the standalone provider.
