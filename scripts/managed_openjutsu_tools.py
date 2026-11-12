#!/usr/bin/env python3
"""Explicit, same-rental OpenJutsu node preparation. Never rents/resumes or downloads weights."""
import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import socket
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import uuid


def atomic(file, value):
    file = Path(file); file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.tmp'); temporary.write_text(json.dumps(value)); temporary.replace(file)


def engine_url(root):
    config = Path(root) / 'config/server.json'
    if not config.exists():
        # A compatible external OpenJutsu engine uses its standard port. It is
        # checked read-only; worker() still refuses to restart an external app.
        return 'http://127.0.0.1:8188'
    value = json.loads(config.read_text())
    port = value.get('port')
    if type(port) is not int or not 1 <= port <= 65535 or value.get('host') not in ['127.0.0.1', 'localhost']:
        raise ValueError('The managed ComfyUI endpoint must use a valid loopback host and port in config/server.json.')
    return 'http://127.0.0.1:%d' % port


def queue_idle(root):
    with urllib.request.urlopen(engine_url(root) + '/queue', timeout=5) as response: queue = json.load(response)
    if not all(isinstance(queue.get(k), list) for k in ['queue_running', 'queue_pending']) or queue['queue_running'] or queue['queue_pending']:
        raise ValueError('The GPU queue is active or unknown. No engine restart was performed.')


def missing_tools(registry, request):
    missing = []
    for name in request['classes']:
        if name not in registry:
            missing.append(name); continue
        fields = {**registry[name].get('input', {}).get('required', {}), **registry[name].get('input', {}).get('optional', {})}
        for field in request.get('inputs', {}).get(name, []):
            if field in fields or name == 'VHS_VideoCombine': continue
            parts = field.split('.')
            growing = fields.get(parts[0])
            if len(parts) == 2 and growing and growing[0] == 'COMFY_AUTOGROW_V3':
                template = growing[1].get('template', {})
                definitions = template.get('input', {}).get('required', {})
                child = parts[1]; prefix = template.get('prefix')
                suffix = child[len(prefix):] if prefix and child.startswith(prefix) else ''
                numbered = bool(re.fullmatch(r'0|[1-9]\d*', suffix)) and isinstance(template.get('max'), int) and int(suffix) < template['max']
                if len(definitions) == 1 and (child in template.get('names', []) or numbered): continue
            missing.append(name + '.' + field)
    return missing


def install_local_nodes(comfy, request):
    """Install only our explicit, hash-bound post-processing package."""
    for package in request.get('local_nodes', []):
        if package.get('directory') != 'recast_post_processing' or set(package.get('files', {})) != {'__init__.py', 'motion.py'}:
            raise ValueError('Unknown local post-processing package.')
        target = Path(comfy) / 'custom_nodes' / package['directory']
        if target.is_symlink() or target.parent.is_symlink(): raise ValueError('Refusing a linked post-processing directory.')
        marker = target / '.recast-files.json'
        if marker.is_symlink(): raise ValueError('Refusing a linked post-processing marker.')
        old = json.loads(marker.read_text()) if marker.is_file() else {}
        for name, value in package['files'].items():
            file = target / name; content = value['content'].encode()
            if hashlib.sha256(content).hexdigest() != value['sha256']: raise ValueError('Post-processing source checksum differs.')
            if file.is_symlink(): raise ValueError('Refusing a linked post-processing source.')
            if file.exists() and file.read_bytes() != content and hashlib.sha256(file.read_bytes()).hexdigest() != old.get(name):
                raise ValueError('The post-processing source was edited locally. It was kept.')
        target.mkdir(parents=True, exist_ok=True)
        for name, value in package['files'].items():
            file = target / name; temp = file.with_suffix('.recast-tmp'); temp.write_text(value['content']); temp.replace(file)
        atomic(marker, {name: value['sha256'] for name, value in package['files'].items()})


def install_requirements(python, requirements, constraints, face):
    # FaceRefine/Impact's insightface and SAM2 builds must reuse our constrained
    # PyTorch. PEP517 isolation otherwise downloads a second, unconstrained torch
    # stack just to discover SAM2's build requirements. This workflow uses SAM1;
    # SAM2's optional CUDA extension is neither needed nor used by its graph.
    command = [str(python), '-m', 'pip', 'install', '--no-cache-dir']
    if face:
        command.append('--no-build-isolation')
    command += ['-r', str(requirements), '-c', str(constraints)]
    env = dict(os.environ)
    if face:
        env['SAM2_BUILD_CUDA'] = '0'
    subprocess.run(command, check=True, env=env)


def restart_managed_engine(root, python):
    # The old process can lose its /proc command line before its listening
    # socket closes. Keep the unrelated-port guard, but allow shutdown to finish.
    subprocess.run([str(python), str(root / 'scripts/server.py'), 'stop'], check=True)
    port = int(engine_url(root).rsplit(':', 1)[1])
    for _ in range(40):
        with socket.socket() as probe:
            probe.settimeout(.25)
            if probe.connect_ex(('127.0.0.1', port)) != 0:
                break
        time.sleep(.25)
    else:
        raise ValueError('The previous engine still holds its private port. No replacement was started.')
    subprocess.run([str(python), str(root / 'scripts/server.py'), 'start'], check=True)


def status(root, request):
    root = Path(root); marker = root / 'state/openjutsu-tools/current.json'
    record = json.loads(marker.read_text()) if marker.is_file() else {}
    running = False; unknown = False
    if record.get('state') in ['starting', 'running']:
        unknown = not isinstance(record.get('pid'), int)
        try:
            command = Path('/proc/%s/cmdline' % record.get('pid')).read_bytes().split(b'\0')
            running = b'--worker' in command and str(record.get('attempt')).encode() in command
        except FileNotFoundError: pass
        except OSError: unknown = True
    try:
        with urllib.request.urlopen(engine_url(root) + '/object_info', timeout=8) as response: registry = json.load(response)
        missing = missing_tools(registry, request)
    except (OSError, ValueError): missing = ['ComfyUI connection']
    return {'ready': not missing and not running and not unknown, 'running': running, 'unknown': unknown,
            'missing': missing, 'error': record.get('error'), 'key': request['key']}


def worker(root, request, attempt):
    root = Path(root); marker = root / 'state/openjutsu-tools/current.json'
    record = {'attempt': attempt, 'pid': os.getpid(), 'state': 'running', 'error': None}
    with (marker.parent / 'launch.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX); atomic(marker, record)
    try:
        queue_idle(root)
        install = json.loads((root / 'state/install.json').read_text()); comfy = Path(install['comfy_root'])
        # Only our already-managed process may be restarted. Existing external
        # OpenJutsu engines work directly when their nodes are already ready.
        sys.path.insert(0, str(root / 'scripts')); import server
        if not server.running(): raise ValueError('This engine is not managed by Recast. Use the existing OpenJutsu engine or prepare a managed GPU first.')
        python = root / '.venv/bin/python'
        core = request['comfyui']
        if subprocess.check_output(['git', '-C', str(comfy), 'rev-parse', 'HEAD'], text=True).strip() != core['revision']:
            if subprocess.check_output(['git', '-C', str(comfy), 'status', '--porcelain'], text=True).strip():
                raise ValueError('The existing ComfyUI tree contains local changes. It was kept; use the already-working OpenJutsu engine or a separate managed installation.')
            subprocess.run(['git', '-C', str(comfy), 'fetch', '--depth=1', core['repo'], core['revision']], check=True)
            queue_idle(root)
            subprocess.run(['git', '-C', str(comfy), 'checkout', '--detach', core['revision']], check=True)
            subprocess.run([str(python), '-m', 'pip', 'install', '--no-cache-dir', '-r', str(comfy / 'requirements.txt'), '-c', str(root / 'state/torch-constraints.txt')], check=True)
        if request.get('face'):
            if not shutil.which('c++'):
                subprocess.run(['apt-get', 'update', '-qq'], check=True)
                subprocess.run(['apt-get', 'install', '-y', '-qq', 'build-essential', 'python3-dev'], check=True)
            subprocess.run([str(python), '-m', 'pip', 'install', '--no-cache-dir', 'Cython', 'setuptools', 'wheel', 'onnxruntime-gpu', '-c', str(root / 'state/torch-constraints.txt')], check=True)
        for pack in request['packs']:
            target = comfy / 'custom_nodes' / pack['directory']
            if target.is_symlink(): raise ValueError('Refusing a linked custom-node directory.')
            if target.exists():
                if subprocess.check_output(['git', '-C', str(target), 'status', '--porcelain'], text=True).strip():
                    raise ValueError('The existing %s node pack contains local changes. It was kept.' % pack['directory'])
                actual = subprocess.check_output(['git', '-C', str(target), 'rev-parse', 'HEAD'], text=True).strip()
                if actual != pack['revision']:
                    raise ValueError('An existing %s installation differs from the pinned OpenJutsu version. It was kept; update it explicitly before retrying.' % pack['directory'])
            else:
                subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout', pack['repo'], str(target)], check=True)
                subprocess.run(['git', '-C', str(target), 'checkout', '--detach', pack['revision']], check=True)
            requirements = target / 'requirements.txt'
            if requirements.is_file():
                install_requirements(python, requirements, root / 'state/torch-constraints.txt', request.get('face', False))
        if request.get('face'):
            subprocess.run([str(python), '-c', 'import insightface, onnxruntime, segment_anything; assert onnxruntime.get_available_providers()'], check=True)
        queue_idle(root)
        install_local_nodes(comfy, request)
        restart_managed_engine(root, python)
        for _ in range(90):
            current = status(root, request)
            if not current['missing']: break
            time.sleep(1)
        if current['missing']: raise ValueError('OpenJutsu still needs compatible ComfyUI/core nodes: ' + ', '.join(current['missing']))
        record.update(state='ready'); atomic(marker, record)
    except BaseException as error:
        record.update(state='failed', error=str(error)[-1800:]); atomic(marker, record); raise


def remote(root, request, prepare):
    root = Path(root); current = status(root, request)
    if not prepare or current['ready'] or current['running'] or current['unknown']: return current
    queue_idle(root)
    attempt = str(uuid.uuid4()); folder = root / 'state/openjutsu-tools'; folder.mkdir(parents=True, exist_ok=True)
    marker = folder / 'current.json'
    with (folder / 'launch.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        current = status(root, request)
        if current['ready'] or current['running'] or current['unknown']: return current
        atomic(marker, {'attempt': attempt, 'state': 'starting', 'pid': None})
        with (folder / 'setup.log').open('ab') as log:
            child = subprocess.Popen(['python3', str(Path(__file__)), '--worker', attempt, '--root', str(root), '--request', json.dumps(request)], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        atomic(marker, {'attempt': attempt, 'state': 'running', 'pid': child.pid})
    return {'ready': False, 'running': True, 'unknown': False, 'missing': current['missing'], 'key': request['key'], 'error': None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--instance-id', type=int); parser.add_argument('--action', choices=['status', 'prepare'], default='status')
    parser.add_argument('--request', required=True); parser.add_argument('--root'); parser.add_argument('--worker'); parser.add_argument('--remote', action='store_true')
    args = parser.parse_args(); request = json.loads(args.request)
    if args.worker: worker(args.root, request, args.worker); return
    if args.remote:
        print('RECAST_OPENJUTSU_TOOLS ' + json.dumps(remote(args.root, request, args.action == 'prepare')), flush=True); return
    import vast
    from managed_models import check_connection
    config = vast.load(); check_connection(config, args.instance_id); os.environ['RECAST_SSH_BATCH'] = '1'
    root = Path(config['remote_root']); target = root / 'scripts/managed_openjutsu_tools.py'
    if args.action == 'prepare':
        code = 'import sys;from pathlib import Path;p=Path(sys.argv[1]);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(sys.argv[2])'
        vast.remote(config, ['python3', '-c', code, str(target), Path(__file__).read_text()])
    else:
        # Status uses the current helper inline and never writes to the GPU.
        return vast.remote(config, ['python3', '-c', Path(__file__).read_text(), '--remote', '--root', str(root), '--request', args.request])
    first = True
    while True:
        value = vast.remote(config, ['python3', str(target), '--remote', '--root', str(root), '--action', 'prepare' if first else 'status', '--request', args.request], capture_output=True, text=True, timeout=20)
        first = False
        line = next(line for line in value.stdout.splitlines() if line.startswith('RECAST_OPENJUTSU_TOOLS ')); result = json.loads(line[len('RECAST_OPENJUTSU_TOOLS '):]); print(line, flush=True)
        if not result['running']:
            if not result['ready']: raise ValueError(result.get('error') or ', '.join(result['missing']))
            return
        time.sleep(1)


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        detail = error.stderr or error.stdout or 'Remote setup exited with status %s.' % error.returncode
        if isinstance(detail, bytes): detail = detail.decode(errors='replace')
        print('OpenJutsu tool preparation failed: ' + str(detail).strip()[-1800:], file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError) as error:
        print('OpenJutsu tool preparation failed: ' + str(error).strip()[-1800:], file=sys.stderr)
        sys.exit(1)
