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
    parser.add_argument('--model-files')
    parser.add_argument('--action', choices=['download', 'inventory', 'delete'], default='download')
    parser.add_argument('--lora')
    args = parser.parse_args()
    config = vast.load()
    check_connection(config, args.instance_id)
    os.environ['RECAST_SSH_BATCH'] = '1'
    root = Path(config['remote_root'])
    if args.action != 'download':
        if args.action == 'inventory':
            code = ('import sys,json,shutil;sys.path.insert(0,sys.argv[1]);from model_storage import inventory;'
                    'result=inventory(sys.argv[2]);result["freeBytes"]=shutil.disk_usage(sys.argv[2]).free;'
                    'from pathlib import Path;root=Path(sys.argv[2]);'
                    'result["partials"]=[{"id":f["destination"],"size":min(f["size"],p.stat().st_size)} for f in json.loads(sys.argv[3]) if (p:=root/(f["destination"]+".part")).is_file() and not p.is_symlink()];'
                    'print("RECAST_MODEL_STORAGE "+json.dumps(result))')
            vast.remote(config, ['python3', '-c', code, str(root / 'scripts'), str(root / 'models'), json.dumps(selected_manifest()['files'])])
            return
        command = ['python3', str(root / 'scripts/model_storage.py'), '--model-dir', str(root / 'models')]
        if args.action == 'delete':
            from model_storage import lora_parts
            lora_parts(args.lora)
            command.extend(['--delete-lora', args.lora])
        vast.remote(config, command)
        return
    if not args.model_files:
        raise ValueError('Choose model files to download.')
    manifest = selected_manifest(json.loads(args.model_files))
    target = write_remote_manifest(config, manifest)
    vast.remote(config, [str(root / '.venv/bin/python'), str(root / 'scripts/download_models.py'),
                         '--manifest', target, '--model-dir', str(root / 'models')])


if __name__ == '__main__':
    main()
