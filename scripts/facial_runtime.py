"""Explicit, isolated CUDA runtime for source-driven facial consistency."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT.parent / 'models/face_consistency'


def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 ** 2), b''):
            h.update(chunk)
    return h.hexdigest()


def profile():
    return json.loads((ROOT / 'config/facial-consistency-runtime.lock.json').read_text())


def profile_hash():
    return hashlib.sha256(((ROOT / 'config/facial-consistency-runtime.lock.json').read_bytes() +
                           (ROOT / 'config/facial-consistency-models.lock.json').read_bytes())).hexdigest()


def paths():
    return ROOT / '.local/facefusion-eval', ROOT / '.local/face-venv/bin/python'


def model_path(item, model_root=None):
    relative = Path(item['destination'])
    if relative.parts[0] != 'face_consistency' or '..' in relative.parts or relative.is_absolute():
        raise ValueError('Invalid pinned facial-model path.')
    return Path(model_root or MODEL_ROOT).joinpath(*relative.parts[1:])


def inspect(verify=False, model_root=None):
    source, python = paths()
    marker = ROOT / 'state/runtime-ready.json'
    missing = []
    try:
        ready = json.loads(marker.read_text())['profileSHA256'] == profile_hash() and python.is_file()
        revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        ready = ready and revision == profile()['revision']
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        ready = False
    if not ready:
        missing.append('Isolated facial-processing runtime')
    manifest = json.loads((ROOT / 'config/facial-consistency-models.lock.json').read_text())
    for item in manifest['files']:
        file = model_path(item, model_root)
        if file.is_symlink() or file.parent.is_symlink() or not file.is_file() or file.stat().st_size != item['size'] or verify and digest(file) != item['sha256']:
            missing.append(item['destination'])
    return {'ready': not missing, 'runtimeReady': ready, 'missing': missing, 'profileSHA256': profile_hash(), 'bytes': manifest['total_bytes']}


def link_models(model_root=None):
    source, _ = paths()
    folder = source / '.assets/models'
    if folder.is_symlink():
        raise ValueError('Unexpected linked FaceFusion model folder.')
    folder.mkdir(parents=True, exist_ok=True)
    for name in profile()['facefusion_models']:
        target = (Path(model_root or MODEL_ROOT) / 'facefusion' / name).resolve()
        alias = folder / name
        if alias.is_symlink():
            if alias.resolve() != target:
                raise ValueError('A face-model alias points to another model set.')
        elif alias.exists():
            raise ValueError('An unexpected face-model file already exists; it was preserved.')
        else:
            alias.symlink_to(target)


def prepare():
    """Called only after an explicit download/update action, never Generate."""
    (ROOT / 'state').mkdir(parents=True, exist_ok=True)
    with (ROOT / 'state/runtime-setup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if inspect()['runtimeReady']:
            link_models()
            return
        if platform.machine() != 'x86_64':
            raise ValueError('Facial consistency currently needs an x86_64 NVIDIA host. No facial model download was started.')
        if shutil.disk_usage(ROOT).free < 5 * 1024 ** 3 + profile()['runtime_reserve_bytes']:
            raise ValueError('Free 5.9 GB including the facial-runtime working reserve before preparing these tools.')
        source, python = paths()
        engine = ROOT.parent / '.venv/bin/python'
        cuda = subprocess.check_output([str(engine), '-c', 'import torch;print(torch.version.cuda)'], text=True).strip()
        if not cuda.startswith('13.'):
            raise ValueError('The pinned facial runtime needs the existing CUDA 13 engine. ComfyUI was not changed.')
        print('RECAST_FACIAL_STAGE Preparing isolated face tools', flush=True)
        if not source.exists():
            subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout', profile()['repository'], str(source)], check=True)
            subprocess.run(['git', '-C', str(source), 'checkout', '--detach', profile()['revision']], check=True)
        if subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip() != profile()['revision']:
            raise ValueError('The face-tool source revision changed; existing files were preserved.')
        if not python.exists():
            subprocess.run([str(engine), '-m', 'venv', '--system-site-packages', str(python.parent.parent)], check=True)
        engine_site = subprocess.check_output([str(engine), '-c', 'import sysconfig;print(sysconfig.get_paths()["purelib"])'], text=True).strip()
        face_site = Path(subprocess.check_output([str(python), '-c', 'import sysconfig;print(sysconfig.get_paths()["purelib"])'], text=True).strip())
        (face_site / 'engine.pth').write_text(engine_site + '\n')
        env = {**os.environ, 'PIP_NO_CACHE_DIR': '1'}
        if Path('/dev/shm').is_dir():
            env['TMPDIR'] = '/dev/shm'
        subprocess.run([str(python), '-m', 'pip', 'install', *profile()['packages']], env=env, check=True)
        subprocess.run([str(python), '-c', 'import torch,onnxruntime as o;o.preload_dlls();assert torch.cuda.is_available() and "CUDAExecutionProvider" in o.get_available_providers()'], check=True)
        link_models()
        marker = ROOT / 'state/runtime-ready.json'
        temporary = marker.with_suffix('.tmp.json')
        temporary.write_text(json.dumps({'profileSHA256': profile_hash()}))
        temporary.replace(marker)
        print('RECAST_FACIAL_STAGE Face tools prepared; model weights stay on demand', flush=True)
