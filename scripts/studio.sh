#!/usr/bin/env bash
set -euo pipefail
RECAST_REPO="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RECAST_REPO/studio"
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' ; then
  echo 'Recast needs Node.js 24 or newer.' >&2
  exit 1
fi
for dependency in npm python3 ffmpeg ffprobe; do
  if ! command -v "$dependency" >/dev/null; then
    echo "Install $dependency, then start Recast again." >&2
    exit 1
  fi
done
python3 "$RECAST_REPO/scripts/setup_local_geometry.py"
if [[ ! -d node_modules ]]; then npm ci --no-audit --no-fund; fi
npm run build
exec node dist-server/index.js
