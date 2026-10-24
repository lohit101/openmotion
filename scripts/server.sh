#!/usr/bin/env bash
set -euo pipefail
SWAP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -x "$SWAP_ROOT/.venv/bin/python" ]]; then
  echo "Run scripts/bootstrap.sh on the GPU instance first." >&2
  exit 1
fi
exec "$SWAP_ROOT/.venv/bin/python" "$SWAP_ROOT/scripts/server.py" "$@"
