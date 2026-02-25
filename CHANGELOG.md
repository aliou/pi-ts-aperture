# @aliou/pi-ts-aperture

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
