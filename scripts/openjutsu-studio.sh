#!/usr/bin/env bash
set -euo pipefail
RECAST_REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export PORT="${PORT:-3003}"
if [[ -z "${RECAST_DATA:-}" ]]; then
  if [[ -f "$RECAST_REPO/studio/data/openjutsu-preview/studio.sqlite" ]]; then
    export RECAST_DATA="$RECAST_REPO/studio/data/openjutsu-preview"
  else
    export RECAST_DATA="$RECAST_REPO/studio/data/openjutsu"
  fi
fi
# Use the full application entry point: SSH reconnect, cloud safety,
# transfer recovery and the normal five-minute idle policy are retained.
exec bash "$RECAST_REPO/scripts/studio.sh" --native-motion
