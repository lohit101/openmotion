#!/usr/bin/env python3
"""Explicit helper-only update on an already-online managed engine.

No provider actions, package installs, git, model transfers or inference. A lost
observer attaches to the one owned journal; status never restarts the engine.
"""
import argparse
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
CLASSES = ['RecastViggleSource124', 'RecastViggleSaveSharedAnchor', 'RecastViggleSharedAnchor']
PREFIX = 'RECAST_VIGGLE_TOOLS '


def sha(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


def atomic(file, value):
    file = Path(file); file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix('.tmp.json'); temp.write_text(json.dumps(value)); temp.replace(file)


def get_json(url):
    with urllib.request.urlopen(url, timeout=5) as response: return json.load(response)


def idle_queue(port):
    queue = get_json('http://127.0.0.1:%s/queue' % port)
    if not isinstance(queue.get('queue_running'), list) or not isinstance(queue.get('queue_pending'), list) or queue['queue_running'] or queue['queue_pending']:
        raise ValueError('The engine queue is active or unknown; no helper files were changed.')


def owned_process(record):
    pid = record.get('pid')
    if record.get('state') == 'starting' and pid is None: return False, True
    if not isinstance(pid, int) or pid < 2: return False, False
    try:
        os.kill(pid, 0)
    except ProcessLookupError: return False, False
    except OSError: return False, True
    try:
        command = Path('/proc/%s/cmdline' % pid).read_bytes().split(b'\0')
    except OSError: return False, True
    required = [str(record.get('script', '')).encode(), b'--remote-worker', str(record.get('attempt', '')).encode()]
    return all(value and value in command for value in required), False


def remote_status(root, manifest):
    root = Path(root); marker = root / 'state/viggle-tools/current.json'
    value = json.loads(marker.read_text()) if marker.is_file() else {}
    running, unknown = owned_process(value)
    ready = False
    if running or unknown:
        return {'ready': False, 'running': running, 'unknown': unknown, 'confirmedStopped': False,
                'helperSHA256': manifest['key'], 'state': 'preparing' if running else 'unknown'}
    try:
        install = json.loads((root / 'state/install.json').read_text())
        config = json.loads((root / 'config/server.json').read_text())
        directory = Path(install['comfy_root']) / 'custom_nodes/character_swap_helpers'
        actual = {name: sha(directory / name) for name in manifest['files'] if (directory / name).is_file()}
        info = {name: get_json('http://127.0.0.1:%s/object_info/%s' % (config['port'], name)) for name in CLASSES}
        spec = importlib.util.spec_from_file_location('owned_viggle_server_status', root / 'scripts/server.py')
        server = importlib.util.module_from_spec(spec); spec.loader.exec_module(server)
        process = server.running()
        ready = actual == manifest['files'] and all(c in info[c] for c in CLASSES) and bool(process) and process.get('runtime_key') == server.runtime_key(install)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError): pass
    return {'ready': ready and not running and not unknown, 'running': running, 'unknown': unknown,
            'confirmedStopped': not running and not unknown, 'helperSHA256': manifest['key'],
            'state': 'preparing' if running else 'unknown' if unknown else 'ready' if ready else value.get('state', 'missing'),
            **({'error': value['error']} if value.get('error') else {})}


def install_helpers(root, snapshot, manifest):
    root, snapshot = Path(root), Path(snapshot)
    install = json.loads((root / 'state/install.json').read_text())
    config = json.loads((root / 'config/server.json').read_text())
    idle_queue(config['port'])
    for process in Path('/proc').glob('[0-9]*/cmdline'):
        try: command = process.read_bytes()
        except OSError: continue
        if str(root).encode() in command and any(name in command for name in [b'/facial_worker.py', b'/upscale_worker.py', b'/clarity_worker.py', b'/video_face_worker.py']) and any(b'worker' == x or b'run' == x for x in command.split(b'\0')):
            raise ValueError('Another managed processing worker is active; no engine update was started.')
    targets = [root / 'custom_nodes/character_swap_helpers', Path(install['comfy_root']) / 'custom_nodes/character_swap_helpers']
    if not (root / 'scripts/server.py').is_file(): raise ValueError('Existing managed server tools are missing.')
    for directory in targets:
        if directory.is_symlink() or any(parent.is_symlink() for parent in directory.parents): raise ValueError('Unsafe managed helper directory.')
        directory.mkdir(parents=True, exist_ok=True)
        for name, expected in manifest['files'].items():
            if Path(name).name != name or not name.endswith('.py') or (snapshot / name).is_symlink() or sha(snapshot / name) != expected or (directory / name).is_symlink(): raise ValueError('Helper snapshot is unsafe or changed.')
    idle_queue(config['port'])
    for directory in targets:
        for name in manifest['files']:
            temp = directory / (name + '.update-part')
            temp.write_bytes((snapshot / name).read_bytes()); os.replace(temp, directory / name)
    # This existing command only checks owned code, stops an idle Comfy service
    # and starts it with its already-installed interpreter. It does not invoke
    # bootstrap.sh, git, pip, model downloaders, or a provider action.
    subprocess.run([sys.executable, str(root / 'scripts/server.py'), 'sync'], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=120)


def remote_worker(root, snapshot, attempt):
    snapshot = Path(snapshot); manifest = json.loads((snapshot / 'manifest.json').read_text())
    record = {'pid': os.getpid(), 'script': str(Path(__file__).resolve()), 'attempt': attempt,
              'state': 'preparing', 'helperSHA256': manifest['key'], 'startedAt': time.time()}
    journal = Path(root) / 'state/viggle-tools' / (attempt + '.json')
    marker = journal.with_name('current.json')
    atomic(journal, record); atomic(marker, record)
    try:
        install_helpers(root, snapshot, manifest)
        record.update(state='complete', finishedAt=time.time())
    except BaseException as error:
        # Save a bounded message, never the SSH command, private key or headers.
        record.update(state='failed', error=str(error)[:350] if isinstance(error, ValueError) else type(error).__name__, finishedAt=time.time())
    atomic(journal, record); atomic(marker, record)


def _remote_start_locked(root, snapshot, attempt):
    manifest = json.loads((Path(snapshot) / 'manifest.json').read_text())
    value = remote_status(root, manifest)
    if value['ready'] or value['running'] or value['unknown']: return value
    config = json.loads((Path(root) / 'config/server.json').read_text()); idle_queue(config['port'])
    # One owned detached mutation, with persisted intent before launch. Polling
    # and recovery never call this start action again automatically.
    uuid.UUID(attempt)
    folder = Path(root) / 'state/viggle-tools'; folder.mkdir(parents=True, exist_ok=True)
    record = {'state': 'starting', 'attempt': attempt, 'helperSHA256': manifest['key'], 'script': str(Path(__file__).resolve()), 'pid': None, 'createdAt': time.time()}
    atomic(folder / 'current.json', record)
    with (folder / (attempt + '.log')).open('ab') as log:
        child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--remote-worker', '--root', str(root), '--snapshot', str(snapshot), '--attempt', attempt],
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    current = json.loads((folder / 'current.json').read_text())
    if current.get('attempt') == attempt and current.get('state') == 'starting':
        record.update(pid=child.pid, state='preparing'); atomic(folder / 'current.json', record)
    return {'ready': False, 'running': True, 'unknown': False, 'confirmedStopped': False, 'state': 'preparing', 'helperSHA256': manifest['key']}


def remote_start(root, snapshot, attempt):
    folder = Path(root) / 'state/viggle-tools'; folder.mkdir(parents=True, exist_ok=True)
    with (folder / 'start.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return _remote_start_locked(root, snapshot, attempt)


def snapshot_manifest():
    files = {p.name: sha(p) for p in sorted((ROOT / 'custom_nodes/character_swap_helpers').glob('*.py'))}
    updater = sha(__file__)
    key = hashlib.sha256(json.dumps({'files': files, 'updater': updater}, sort_keys=True).encode()).hexdigest()
    return {'key': key, 'files': files, 'updaterSHA256': updater}


def status_program(remote_root):
    code = '__file__ = ' + repr(str(Path(remote_root) / 'scripts/managed_viggle_tools.py')) + '\n'
    code += Path(__file__).read_text().rsplit("\nif __name__ == '__main__':", 1)[0]
    return code + '\nprint(json.dumps(remote_status(sys.argv[1], json.loads(sys.argv[2]))))\n'


def local(action, instance_id):
    import vast
    from managed_models import check_connection
    config = vast.load(); check_connection(config, instance_id)
    manifest = snapshot_manifest(); remote_root = Path(config['remote_root'])
    snapshot = remote_root / 'state/viggle-tools/snapshots' / manifest['key']
    script = snapshot / 'managed_viggle_tools.py'
    # Read-only status uses current code over stdin; no remote file upload or
    # engine start. This also works before the first helper update was staged.
    def status():
        code = status_program(remote_root)
        result = vast.remote(config, ['python3', '-c', code, str(remote_root), json.dumps(manifest)], capture_output=True, text=True, timeout=15)
        return json.loads(result.stdout.strip().splitlines()[-1])
    try:
        value = status()
        if action == 'status' or value['ready']:
            print(PREFIX + json.dumps({**value, 'instanceId': instance_id}), flush=True); return
        if not value['running'] and not value['unknown']:
            # Upload only a small immutable code snapshot, never weights.
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode='w:gz') as archive:
                for name in manifest['files']: archive.add(ROOT / 'custom_nodes/character_swap_helpers' / name, arcname=name)
                archive.add(Path(__file__), arcname='managed_viggle_tools.py')
                data = json.dumps(manifest).encode(); info = tarfile.TarInfo('manifest.json'); info.size = len(data); archive.addfile(info, io.BytesIO(data))
            buffer.seek(0)
            upload = '''import pathlib,tarfile,sys
p=pathlib.Path(sys.argv[1]);p.mkdir(parents=True,exist_ok=True)
if p.is_symlink():raise ValueError('Unsafe snapshot')
with tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz')as a:
 for m in a:
  if pathlib.Path(m.name).name!=m.name or not m.isfile():raise ValueError('Unsafe helper archive')
  dest=p/m.name;data=a.extractfile(m).read()
  if dest.exists()and dest.read_bytes()!=data:raise ValueError('Immutable helper snapshot differs')
  if not dest.exists():dest.write_bytes(data)
'''
            vast.remote(config, ['python3', '-c', upload, str(snapshot)], stdin=buffer, capture_output=True, timeout=20)
            # This is the single explicit start; an uncertain response only
            # observes status below, and never submits another worker.
            try:
                result = vast.remote(config, ['python3', str(script), '--remote-start', '--root', str(remote_root), '--snapshot', str(snapshot), '--attempt', str(uuid.uuid4())], capture_output=True, text=True, timeout=15)
                value = json.loads(result.stdout.strip().splitlines()[-1])
            except (OSError, subprocess.SubprocessError, ValueError): value = {'unknown': True}
        for _ in range(80):
            value = status()
            print(PREFIX + json.dumps({**value, 'instanceId': instance_id}), flush=True)
            if value['ready']: return
            if value['confirmedStopped']: raise ValueError(value.get('error') or 'Updated motion tools are not ready. Retry their explicit preparation.')
            time.sleep(1)
        raise ValueError('Still checking the owned motion-tool update. Reconnect to inspect it; do not start another setup.')
    except BaseException as error:
        if isinstance(error, (KeyboardInterrupt, SystemExit)): raise
        message = str(error)[:350] if isinstance(error, ValueError) else type(error).__name__
        known = value if isinstance(locals().get('value'), dict) and value.get('confirmedStopped') is True else {'ready': False, 'running': False, 'unknown': True, 'confirmedStopped': False}
        print(PREFIX + json.dumps({**known, 'instanceId': instance_id, 'helperSHA256': manifest['key'], 'error': message}), flush=True)
        print(message, file=sys.stderr)
        raise SystemExit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--instance-id', type=int); parser.add_argument('--action', choices=['prepare', 'status'], default='prepare')
    parser.add_argument('--remote-start', action='store_true'); parser.add_argument('--remote-worker', action='store_true')
    parser.add_argument('--root', type=Path); parser.add_argument('--snapshot', type=Path); parser.add_argument('--attempt')
    args = parser.parse_args()
    if args.remote_worker: remote_worker(args.root, args.snapshot, args.attempt)
    elif args.remote_start: print(json.dumps(remote_start(args.root, args.snapshot, args.attempt)))
    else:
        if not args.instance_id: parser.error('--instance-id is required')
        local(args.action, args.instance_id)


if __name__ == '__main__': main()
