#!/usr/bin/env python3
"""Download explicitly selected pinned files on the existing managed rental, without starting compute."""
import argparse
import json
import os
import inspect
from pathlib import Path

import vast
from model_manifest import is_content_filter_weight, selected_manifest


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


def native_models():
    root = Path(__file__).resolve().parents[1] / 'config'
    motion = json.loads((root / 'openjutsu-models.lock.json').read_text())
    face = json.loads((root / 'openjutsu-face-models.lock.json').read_text())
    return {'files': motion['files'] + face['files'], 'shared': motion['shared']}


def register_download_paths(config, files):
    patches = [item['destination'] for item in files if item['destination'].startswith('model_patches/')]
    if patches:
        # Cached engines may predate a newly added extra-model-path category.
        # An owned file alias is discoverable immediately by the native loader.
        vast.remote(config, ['python3', '-c', MODEL_PATCH_PATHS, config['remote_root'], json.dumps(patches)])
    native = native_models()
    owned = {f['destination'] for f in native['files']} | set(native['shared'])
    destinations = [f['destination'] for f in files if f['destination'] in owned]
    if destinations:
        from gpu_files import active_comfy_root
        code = inspect.getsource(active_comfy_root) + '''
import sys,json
from pathlib import Path
root=Path(sys.argv[1]);engine=active_comfy_root(root)
if engine is None:
    engine=Path(json.loads((root/'state/install.json').read_text())['comfy_root'])
for name in json.loads(sys.argv[2]):
    relative=Path(name)
    if relative.is_absolute() or '..' in relative.parts or len(relative.parts)<2:raise ValueError('Invalid model destination')
    source=root/'models'/relative;alias=engine/'models'/relative
    if source.is_symlink() or not source.is_file():raise ValueError('The downloaded model is unavailable')
    if alias==source:continue
    parent=engine/'models'
    if parent.is_symlink():raise ValueError('Refusing a linked model directory')
    for part in relative.parts[:-1]:
        parent=parent/part
        if parent.is_symlink():raise ValueError('Refusing a linked model category')
    alias.parent.mkdir(parents=True,exist_ok=True)
    if alias.exists() or alias.is_symlink():
        if alias.is_symlink() and alias.resolve()==source.resolve():continue
        if alias.is_file() and alias.stat().st_size==source.stat().st_size:continue
        raise ValueError('An existing model has the same name; it was kept')
    alias.symlink_to(source)
'''
        vast.remote(config, ['python3', '-c', code, config['remote_root'], json.dumps(destinations)])


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
    parser.add_argument('--file')
    parser.add_argument('--recover',action='store_true')
    parser.add_argument('--cancel-transfer',action='store_true')
    args = parser.parse_args()
    config = vast.load()
    check_connection(config, args.instance_id)
    os.environ['RECAST_SSH_BATCH'] = '1'
    root = Path(config['remote_root'])
    if args.action != 'download':
        if args.action == 'inventory':
            face_files=[]
            for name in ['local-identity.lock.json','local-video-identity.lock.json']:
                face_files.extend(item for item in json.loads((Path(__file__).resolve().parents[1]/'config'/name).read_text())['files'] if not is_content_filter_weight(item['path']))
            code = ('import sys,json,shutil;sys.path.insert(0,sys.argv[1]);from model_storage import inventory;'
                    'result=inventory(sys.argv[2]);result["freeBytes"]=shutil.disk_usage(sys.argv[2]).free;'
                    'from pathlib import Path;root=Path(sys.argv[2]);'
                    'result["partials"]=[{"id":f["destination"],"size":min(f["size"],p.stat().st_size)} for f in json.loads(sys.argv[3]) if (p:=root/(f["destination"]+".part")).is_file() and not p.is_symlink()];'
                    'result["files"]=[{"id":f["destination"],"size":p.stat().st_size,"verified":(not f["destination"].startswith("face_consistency/") or (p.stat().st_size==f["size"] and (stamp:=p.with_name(p.name+".verified.json")).is_file() and json.loads(stamp.read_text())=={"sha256":f["sha256"],"size":f["size"],"mtime_ns":p.stat().st_mtime_ns}))} for f in json.loads(sys.argv[3]) if (p:=root/f["destination"]).is_file() and not p.is_symlink() and not p.parent.is_symlink()];'
                    'face=root.parent/"face-refinement-runtime/.local/facefusion-eval";'
                    'result["files"] += [{"id":"face-refinement/"+Path(f["path"]).name,"size":p.stat().st_size} for f in json.loads(sys.argv[4]) if (p:=face/f["path"]).is_file() and not p.is_symlink() and not p.parent.is_symlink()];'
                    'result["partials"] += [{"id":"face-refinement/"+Path(f["path"]).name,"size":min(f["size"],p.stat().st_size)} for f in json.loads(sys.argv[4]) if (p:=face/(f["path"]+".part")).is_file() and not p.is_symlink() and not p.parent.is_symlink()];'
                    'marker=root.parent/"facial-runtime/state/runtime-ready.json";'
                    'result["facialRuntimeReady"]=marker.is_file() and json.loads(marker.read_text()).get("sceneProfileSHA256")==sys.argv[5] and json.loads(marker.read_text()).get("timingSHA256")==sys.argv[6];'
                    'result["facialCleanupRuntimeReady"]=result["facialRuntimeReady"] and json.loads(marker.read_text()).get("cleanupProfileSHA256")==sys.argv[7] and json.loads(marker.read_text()).get("cleanupWorkerSHA256") in json.loads(sys.argv[8]);'
                    'result["facialCalibratedRuntimeReady"]=result["facialCleanupRuntimeReady"] and json.loads(marker.read_text()).get("calibrationProfileSHA256")==sys.argv[9];'
                    'result["facialGeometryRuntimeReady"]=result["facialCleanupRuntimeReady"] and json.loads(marker.read_text()).get("geometryProfiles")==json.loads(sys.argv[11]);'
                    'result["facialBoundaryRuntimeReady"]=result["facialGeometryRuntimeReady"] and json.loads(marker.read_text()).get("boundaryProfiles")==json.loads(sys.argv[12]) and json.loads(marker.read_text()).get("cleanupWorkerSHA256")==json.loads(sys.argv[8])[0];'
                    'occlusion_marker=root.parent/"facial-runtime/state/occlusion-runtime-ready.json";'
                    'result["facialOcclusionRuntimeReady"]=result["facialBoundaryRuntimeReady"] and result["facialCalibratedRuntimeReady"] and occlusion_marker.is_file() and json.loads(occlusion_marker.read_text()).get("profileSHA256")==sys.argv[13];'
                    'eye_marker=root.parent/"facial-runtime/state/eye-runtime-ready.json";'
                    'result["facialEyeFinishRuntimeReady"]=result["facialCalibratedRuntimeReady"] and eye_marker.is_file() and json.loads(eye_marker.read_text()).get("profileSHA256")==sys.argv[10] and json.loads(eye_marker.read_text()).get("nativeBindingsVerified") is True;'
                    '\nfor proc in Path("/proc").glob("[0-9]*"):\n'
                    ' try:\n'
                    '  args=(proc/"cmdline").read_bytes().split(bytes([0]))\n'
                    ' except FileNotFoundError:continue\n'
                    ' if (str(root.parent/"facial-runtime/scripts/facial_worker.py").encode() in args and b"prepare" in args) or (str(root.parent).encode() in args and b"worker" in args and any(a.endswith(b"/model_setup_worker.py") for a in args)):result["facialPreparing"]=True;break\n'
                    'print("RECAST_MODEL_STORAGE "+json.dumps(result))')
            # The user's working OpenJutsu installation may already own these
            # weights outside the older managed directory. Inspect its actual
            # files rather than downloading another copy based on a stale root.
            from gpu_files import active_comfy_root
            extra = ('\nengine=active_comfy_root(root.parent)\n'
                     'if engine is not None:\n'
                     ' for f in json.loads(sys.argv[14]):\n'
                     '  p=engine/"models"/f["destination"]\n'
                     '  if p.is_file() and p.stat().st_size==f["size"]:result["files"].append({"id":f["destination"],"size":p.stat().st_size})\n'
                     ' result["loras"] += [f for f in inventory(engine/"models")["loras"] if f["name"] not in {x["name"] for x in result["loras"]}]\n')
            code = inspect.getsource(active_comfy_root) + '\n' + code.replace('print("RECAST_MODEL_STORAGE "+json.dumps(result))', extra + 'print("RECAST_MODEL_STORAGE "+json.dumps(result))')
            facial = __import__('managed_facial_consistency')
            geometry = {f'source-face-v{n}': facial.fingerprint(f'source-face-v{n}') for n in [6, 7, 8]}
            boundary = {f'source-face-v{n}': facial.fingerprint(f'source-face-v{n}') for n in [9, 10]}
            from facial_runtime import compatible_worker_hashes
            native_files = native_models()
            native_ids = [f['destination'] for f in native_files['files']] + native_files['shared']
            vast.remote(config, ['python3', '-c', code, str(root / 'scripts'), str(root / 'models'), json.dumps(selected_manifest()['files']),json.dumps(face_files), facial.fingerprint('source-face-v2'), facial.digest(facial.ROOT / 'scripts/video_timing.py'), facial.fingerprint('source-face-v3'), json.dumps(compatible_worker_hashes()), facial.fingerprint('source-face-v4'), facial.fingerprint('source-face-v5'), json.dumps(geometry), json.dumps(boundary), facial.fingerprint('source-face-v11'), json.dumps(selected_manifest(native_ids)['files'])])
            return
        # Execute the current small storage helper without reinstalling the
        # engine or relying on an older helper on a retained rental.
        from gpu_files import active_comfy_root
        command = ['python3', '-c', inspect.getsource(active_comfy_root) + '\n' + Path(__file__).with_name('model_storage.py').read_text(), '--model-dir', str(root / 'models')]
        if args.action == 'delete':
            from model_storage import lora_parts, relative_parts
            if args.file is not None:
                relative_parts(args.file)
                allowed = [item['destination'] for item in selected_manifest()['files']]
                face_files = {}
                for manifest in ['local-identity.lock.json', 'local-video-identity.lock.json']:
                    for item in json.loads((Path(__file__).resolve().parents[1] / 'config' / manifest).read_text())['files']:
                        if not is_content_filter_weight(item['path']):
                            face_files['face-refinement/' + Path(item['path']).name] = item['path']
                if args.file not in allowed and args.file not in face_files:
                    if not args.file.startswith('loras/'):
                        raise ValueError('Only catalog models and custom LoRAs can be deleted.')
                    lora_parts(args.file[6:])
                command.extend(['--delete-file', args.file, '--allowed-files', json.dumps(allowed), '--face-dir', str(root / 'face-refinement-runtime/.local/facefusion-eval'), '--face-files', json.dumps(face_files)])
                native = native_models()
                command.extend(['--native-workspace', str(root), '--native-files', json.dumps([f['destination'] for f in native['files']] + native['shared'])])
            else:
                lora_parts(args.lora)
                command.extend(['--delete-lora', args.lora])
        vast.remote(config, command)
        return
    if not args.model_files:
        raise ValueError('Choose model files to download.')
    manifest = selected_manifest(json.loads(args.model_files))
    from managed_model_download import transfer
    for item in manifest['files']:
        if not transfer(config,selected_manifest([item['destination']]),args.recover,args.cancel_transfer):return
    register_download_paths(config, manifest['files'])


if __name__ == '__main__':
    main()
