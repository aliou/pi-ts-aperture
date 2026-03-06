# @aliou/pi-ts-aperture

## 0.3.1

### Patch Changes

- 8b885ea: bump @aliou/pi-utils-settings to ^0.10.0 (local scope fix)

## 0.3.0

### Minor Changes

- dffb404: Refactor the Aperture routing implementation into focused modules and improve startup model discovery.

  ### What changed

  - Split the previous large `src/index.ts` into a clearer architecture:
    - `src/providers/aperture.ts` for routing/bootstrap/model refresh logic
    - `src/providers/model-config.ts` for model synthesis/merge helpers
    - `src/lib/aperture-api.ts` for Aperture API discovery calls
    - `src/state/provider-model-cache.ts` for in-memory model cache state
  - Keep `src/index.ts` as orchestration only (load config, register hooks/commands).
  - Preserve and explicitly inject provenance headers when routing through Aperture:
    - `Referer: https://pi.dev`
    - `X-Title: npm:@aliou/pi-ts-aperture`
  - Fix active model refresh timing by awaiting model re-resolution before request execution.
  - Improve OpenRouter CLI model selection reliability by bootstrapping discovered models from Aperture when needed.

  ### Why minor

  This release introduces observable behavior improvements (model availability/routing reliability and header behavior) in addition to internal refactoring.

## 0.2.5

### Patch Changes

- d3f068c: Fix timing issue where active model was cached before before_agent_start event fired. Now re-resolves the active model after updating the registry to ensure Aperture routing is applied correctly.

## 0.2.4

### Patch Changes

- d988f99: Remove debug log

## 0.2.3

### Patch Changes

- 3119e9a: Plug provider unregistration - call pi.unregisterProvider() immediately when providers are removed via setup/settings, instead of warning that a /reload is required. Switch to pi.registerProvider() for registration. Bump peer dep to >=0.55.3.

## 0.2.2

### Patch Changes

- 909e72c: Fix model preservation when overriding providers - delay registration to before_agent_start event so models from other extensions are not lost

## 0.2.1

### Patch Changes

- cf32bda: Move `@mariozechner/pi-tui` to peer dependencies to avoid bundling the SDK alongside the extension.

## 0.2.0

### Minor Changes

- 926f0a9: Improve `/aperture:setup` provider and connectivity flow.

  - Add URL health check during setup (`/v1/models`) before provider selection, with retry/cancel UX.
  - Build provider choices from Pi's runtime model registry so extension-registered providers (for example `pi-synthetic`) appear in the setup list.

### Patch Changes

- 2263fc2: mark pi SDK peer deps as optional to prevent koffi OOM in Gondolin VMs

## 0.1.0

### Minor Changes

- ebb9556: Initial release. Route Pi LLM providers through Tailscale Aperture.

  - `/aperture:setup` interactive wizard (base URL + provider multi-select)
  - `/aperture:settings` settings UI for updating configuration
  - Auto-registers selected providers with Aperture base URL on load

### Patch Changes

- 7388139: Fix providers not taking effect immediately after setup/settings save. Register directly on modelRegistry and re-resolve the active model when it belongs to a reconfigured provider.
