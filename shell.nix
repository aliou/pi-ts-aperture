{ pkgs ? import <nixpkgs> { } }:

let
  pi-no-env = pkgs.writeShellApplication {
    name = "pi-no-env";

    runtimeInputs = with pkgs; [ coreutils ];

    text = ''
      set -euo pipefail

      # Resolve project root from cwd (always the shell's working directory)
      ROOT="$(pwd)"

      # Isolated pi state directory (writable, not in nix store)
      PI_NO_ENV="$ROOT/.pi-no-env"
      mkdir -p "$PI_NO_ENV/agent"

      exec env \
        PI_CODING_AGENT_DIR="$PI_NO_ENV/agent" \
        pi -e "$ROOT" "$@"
    '';
  };
in
pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs
    pnpm_10
    pi-no-env
  ];

  shellHook = ''
    mkdir -p .pi-no-env/agent
  '';
}
