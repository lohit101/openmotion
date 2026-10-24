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
if [[ -s "$RECAST_ROOT/state/managed-provision.log" ]]; then
  cp "$RECAST_ROOT/state/managed-provision.log" "$RECAST_ROOT/state/managed-provision.previous.log"
  : > "$RECAST_ROOT/state/managed-provision.log"
fi
python3 -u "$RECAST_ROOT/scripts/setup_required.py"
