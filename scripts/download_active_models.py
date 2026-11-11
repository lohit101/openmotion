#!/usr/bin/env python3
"""Download only retained Studio models; defaults to native Remotion's bundle."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import download_models
from active_model_manifest import default_download_manifest
from model_policy import assert_downloadable


def main():
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--manifest', type=Path)
    selected, rest = parser.parse_known_args()
    manifest = json.loads(selected.manifest.read_text()) if selected.manifest else default_download_manifest()
    assert_downloadable([item['destination'] for item in manifest['files']])
    # Reuse the pinned, resumable transport without changing its historical
    # bytes or facial runtime fingerprints. Other flags keep their meanings.
    with tempfile.TemporaryDirectory(prefix='recast-model-plan-') as folder:
        file = Path(folder) / 'manifest.json'; file.write_text(json.dumps(manifest))
        previous = sys.argv
        try:
            sys.argv = [previous[0], '--manifest', str(file), *rest]
            download_models.main()
        finally:
            sys.argv = previous


if __name__ == '__main__': main()
