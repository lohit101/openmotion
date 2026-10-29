#!/usr/bin/env python3
"""Download explicitly selected pinned files on the existing managed rental, without starting compute."""
import argparse
import json
import os
from pathlib import Path

import vast
from model_manifest import selected_manifest, write_remote_manifest


MODEL_PATCH_PATHS = '''
import json, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
comfy = Path(json.loads((root / 'state/install.json').read_text())['comfy_root']).resolve()
directory = comfy / 'models/model_patches'
if directory.is_symlink():
    raise ValueError('Refusing to register files through a symlinked model-patch directory.')
directory.mkdir(parents=True, exist_ok=True)
plans = []
for name in json.loads(sys.argv[2]):
    relative = Path(name)
    if relative.parts != ('model_patches', relative.name) or not relative.name.endswith('.safetensors'):
        raise ValueError('Unsafe model patch destination.')
    target = root / 'models' / relative
    if target.is_symlink() or target.parent.is_symlink() or not target.is_file():
        raise ValueError('The verified model patch is not a regular managed file.')
    alias = directory / relative.name
    if alias.exists() or alias.is_symlink():
        if alias.resolve() != target.resolve():
            raise ValueError('An existing model patch has the same name; it was not overwritten.')
    else:
        plans.append((alias, target))
for alias, target in plans:
    alias.symlink_to(target)
print('Registered model patches without restarting ComfyUI.')
'''


def register_download_paths(config, files):
    patches = [item['destination'] for item in files if item['destination'].startswith('model_patches/')]
    if patches:
        # Cached engines may predate a newly added extra-model-path category.
        # An owned file alias is discoverable immediately by the native loader.
        vast.remote(config, ['python3', '-c', MODEL_PATCH_PATHS, config['remote_root'], json.dumps(patches)])


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
            face_files=[]
            for name in ['local-identity.lock.json','local-video-identity.lock.json']:
                face_files.extend(json.loads((Path(__file__).resolve().parents[1]/'config'/name).read_text())['files'])
            code = ('import sys,json,shutil;sys.path.insert(0,sys.argv[1]);from model_storage import inventory;'
                    'result=inventory(sys.argv[2]);result["freeBytes"]=shutil.disk_usage(sys.argv[2]).free;'
                    'from pathlib import Path;root=Path(sys.argv[2]);'
                    'result["partials"]=[{"id":f["destination"],"size":min(f["size"],p.stat().st_size)} for f in json.loads(sys.argv[3]) if (p:=root/(f["destination"]+".part")).is_file() and not p.is_symlink()];'
                    'result["files"]=[{"id":f["destination"],"size":p.stat().st_size,"verified":(not f["destination"].startswith("face_consistency/") or (p.stat().st_size==f["size"] and (stamp:=p.with_name(p.name+".verified.json")).is_file() and json.loads(stamp.read_text())=={"sha256":f["sha256"],"size":f["size"],"mtime_ns":p.stat().st_mtime_ns}))} for f in json.loads(sys.argv[3]) if (p:=root/f["destination"]).is_file() and not p.is_symlink() and not p.parent.is_symlink()];'
                    'face=root.parent/"face-refinement-runtime/.local/facefusion-eval";'
                    'result["files"] += [{"id":"face-refinement/"+Path(f["path"]).name,"size":p.stat().st_size} for f in json.loads(sys.argv[4]) if (p:=face/f["path"]).is_file() and not p.is_symlink() and not p.parent.is_symlink()];'
                    'result["partials"] += [{"id":"face-refinement/"+Path(f["path"]).name,"size":min(f["size"],p.stat().st_size)} for f in json.loads(sys.argv[4]) if (p:=face/(f["path"]+".part")).is_file() and not p.is_symlink() and not p.parent.is_symlink()];'
                    'marker=root.parent/"facial-runtime/state/runtime-ready.json";'
                    'result["facialRuntimeReady"]=marker.is_file() and json.loads(marker.read_text()).get("sceneProfileSHA256")==sys.argv[5];'
                    'print("RECAST_MODEL_STORAGE "+json.dumps(result))')
            vast.remote(config, ['python3', '-c', code, str(root / 'scripts'), str(root / 'models'), json.dumps(selected_manifest()['files']),json.dumps(face_files), __import__('managed_facial_consistency').fingerprint('source-face-v2')])
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
    if any(item['destination'].startswith('face_consistency/') for item in manifest['files']):
        from managed_facial_consistency import prepare_runtime
        prepare_runtime(config)
    target = write_remote_manifest(config, manifest)
    downloader = root / ('facial-runtime/scripts/download_models.py' if any(item['destination'].startswith('face_consistency/') for item in manifest['files']) else 'scripts/download_models.py')
    vast.remote(config, [str(root / '.venv/bin/python'), str(downloader),
                         '--manifest', target, '--model-dir', str(root / 'models')])
    register_download_paths(config, manifest['files'])


if __name__ == '__main__':
    main()
