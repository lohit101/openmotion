#!/usr/bin/env python3
"""Download explicitly selected pinned files on the existing managed rental, without starting compute."""
import argparse
import json
import os
from pathlib import Path

import vast
from model_manifest import selected_manifest, write_remote_manifest


def check_connection(config, instance_id):
    if config.get('instance_id') != instance_id or config.get('local_port') != 8188:
        raise ValueError('The saved SSH tunnel belongs to a different instance. Reconnect the selected GPU before downloading adapters.')
    if config.get('remote_root') != '/workspace/character-swap':
        raise ValueError('The saved instance uses an unexpected model directory.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instance-id', type=int, required=True)
    parser.add_argument('--model-files', required=True)
    args = parser.parse_args()
    config = vast.load()
    check_connection(config, args.instance_id)
    manifest = selected_manifest(json.loads(args.model_files))
    os.environ['RECAST_SSH_BATCH'] = '1'
    target = write_remote_manifest(config, manifest)
    root = Path(config['remote_root'])
    vast.remote(config, [str(root / '.venv/bin/python'), str(root / 'scripts/download_models.py'),
                         '--manifest', target, '--model-dir', str(root / 'models')])


if __name__ == '__main__':
    main()
