#!/usr/bin/env bash
set -euo pipefail
RECAST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export RECAST_SKIP_MODEL_DOWNLOADS=1
mkdir -p "$RECAST_ROOT/state"
exec 8>"$RECAST_ROOT/state/managed-provision.lock"
flock -n 8 || exit 0
rm -f "$RECAST_ROOT/state/managed-provision.exit"
finish() {
  RECAST_EXIT=$?
  printf '%s\n' "$RECAST_EXIT" > "$RECAST_ROOT/state/managed-provision.exit.tmp"
  mv "$RECAST_ROOT/state/managed-provision.exit.tmp" "$RECAST_ROOT/state/managed-provision.exit"
}
trap finish EXIT
echo 'RECAST_STAGE Installing the pinned ComfyUI runtime'
bash "$RECAST_ROOT/scripts/bootstrap.sh"
echo 'RECAST_STAGE Checking ComfyUI and the GPU'
bash "$RECAST_ROOT/scripts/server.sh" start
"$RECAST_ROOT/.venv/bin/python" "$RECAST_ROOT/scripts/doctor.py" --runtime-only
echo 'RECAST_STAGE ComfyUI installation verified'
