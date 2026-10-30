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

from model_manifest import is_content_filter_weight

ROOT = Path(__file__).resolve().parents[1]
MODEL_ROOT = ROOT.parent / 'models/face_consistency'
EYE_FINISH_FILES = ['config/facial-consistency-eye-finish.lock.json',
                    'config/facial-consistency-eye-finish-models.lock.json',
                    'scripts/face_eye_finish.py', 'scripts/face_eye_motion.py',
                    'scripts/face_eye_placement.py', 'scripts/face_eye_temporal.py']
GEOMETRY_BASES = {'source-face-v6': 'source-face-v3', 'source-face-v7': 'source-face-v4',
                  'source-face-v8': 'source-face-v5'}
GEOMETRY_FILES = ['config/facial-consistency-geometry.lock.json', 'scripts/face_jaw_geometry.py']
GEOMETRY_EYE_FILES = ['scripts/face_geometry_eye_finish.py', 'scripts/face_geometry_eye_motion.py']
BOUNDARY_BASES = {'source-face-v9': 'source-face-v6', 'source-face-v10': 'source-face-v7'}
BOUNDARY_FILES = ['config/facial-consistency-boundary.lock.json', 'scripts/face_boundary_blend.py']


def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 ** 2), b''):
            h.update(chunk)
    return h.hexdigest()


def profile():
    return json.loads((ROOT / 'config/facial-consistency-runtime.lock.json').read_text())


def profile_hash(version='source-face-v1'):
    if version in BOUNDARY_BASES:
        data = bytes.fromhex(profile_hash(BOUNDARY_BASES[version]))
        return hashlib.sha256(data + b''.join((ROOT / name).read_bytes() for name in BOUNDARY_FILES)).hexdigest()
    if version in GEOMETRY_BASES:
        data = bytes.fromhex(profile_hash(GEOMETRY_BASES[version]))
        names = GEOMETRY_FILES + (GEOMETRY_EYE_FILES if version == 'source-face-v8' else [])
        return hashlib.sha256(data + b''.join((ROOT / name).read_bytes() for name in names)).hexdigest()
    if version == 'source-face-v5':
        data = bytes.fromhex(profile_hash('source-face-v4'))
        return hashlib.sha256(data + b''.join((ROOT / name).read_bytes() for name in EYE_FINISH_FILES)).hexdigest()
    data = ((ROOT / 'config/facial-consistency-runtime.lock.json').read_bytes() +
            (ROOT / 'config/facial-consistency-models.lock.json').read_bytes())
    if version == 'source-face-v2':
        data += ((ROOT / 'config/facial-consistency-scene.lock.json').read_bytes() +
                 (ROOT / 'scripts/scene_face_composite.py').read_bytes())
    elif version in ['source-face-v3', 'source-face-v4']:
        data += ((ROOT / 'config/facial-consistency-cleanup.lock.json').read_bytes() +
                 (ROOT / 'config/facial-consistency-cleanup-models.lock.json').read_bytes() +
                 (ROOT / 'scripts/face_feature_cleanup.py').read_bytes())
        if version == 'source-face-v4':
            data += ((ROOT / 'config/facial-consistency-eye.lock.json').read_bytes() +
                     (ROOT / 'scripts/face_eye_calibration.py').read_bytes())
    elif version != 'source-face-v1':
        raise ValueError('Unsupported frozen facial recipe.')
    return hashlib.sha256(data).hexdigest()


def compatible_worker_hashes():
    """The exact deployed worker remains valid for frozen v1–v8 only.

    Adding new opt-in branches must not force an update during a user's legacy
    render. New boundary recipes require the current worker and their marker.
    """
    saved = json.loads((ROOT / BOUNDARY_FILES[0]).read_text())['compatible_legacy_worker_sha256']
    return [digest(ROOT / 'scripts/facial_worker.py'), *saved]


def paths():
    return ROOT / '.local/facefusion-eval', ROOT / '.local/face-venv/bin/python'


def model_path(item, model_root=None):
    relative = Path(item['destination'])
    if relative.parts[0] != 'face_consistency' or '..' in relative.parts or relative.is_absolute():
        raise ValueError('Invalid pinned facial-model path.')
    return Path(model_root or MODEL_ROOT).joinpath(*relative.parts[1:])


def inspect(verify=False, model_root=None, version='source-face-v1'):
    profile_hash(version)  # Reject unknown recipes before inspecting any files.
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
    if version in ['source-face-v3', 'source-face-v4', 'source-face-v5', *GEOMETRY_BASES, *BOUNDARY_BASES]:
        extra = json.loads((ROOT / 'config/facial-consistency-cleanup-models.lock.json').read_text())
        manifest = {**manifest, 'files': [*manifest['files'], *extra['files']], 'total_bytes': manifest['total_bytes'] + extra['total_bytes']}
    if version in ['source-face-v5', 'source-face-v8']:
        extra = json.loads((ROOT / 'config/facial-consistency-eye-finish-models.lock.json').read_text())
        manifest = {**manifest, 'files': [*manifest['files'], *extra['files']], 'total_bytes': manifest['total_bytes'] + extra['total_bytes']}
    ignored_bytes = 0
    for item in manifest['files']:
        if is_content_filter_weight(item['destination']):
            ignored_bytes += item['size']
            continue
        file = model_path(item, model_root)
        if file.is_symlink() or file.parent.is_symlink() or not file.is_file() or file.stat().st_size != item['size'] or verify and digest(file) != item['sha256']:
            missing.append(item['destination'])
    try:
        scene_hash = profile_hash('source-face-v2')
        scene_ready = json.loads(marker.read_text()).get('sceneProfileSHA256') == scene_hash
    except (OSError, ValueError):
        scene_hash, scene_ready = None, False
    timing_hash = digest(ROOT / 'scripts/video_timing.py')
    try:
        timing_ready = json.loads(marker.read_text()).get('timingSHA256') == timing_hash
    except (OSError, ValueError):
        timing_ready = False
    try:
        cleanup_hash = profile_hash('source-face-v3')
        cleanup_ready = (json.loads(marker.read_text()).get('cleanupProfileSHA256') == cleanup_hash and
                         json.loads(marker.read_text()).get('cleanupWorkerSHA256') in compatible_worker_hashes())
    except (OSError, ValueError):
        cleanup_hash, cleanup_ready = None, False
    if version in ['source-face-v3', 'source-face-v4', 'source-face-v5', *GEOMETRY_BASES, *BOUNDARY_BASES] and not cleanup_ready:
        ready = False
        missing.append('Updated facial feature-cleanup tools')
    try:
        calibration_hash = profile_hash('source-face-v4')
        calibration_ready = cleanup_ready and json.loads(marker.read_text()).get('calibrationProfileSHA256') == calibration_hash
    except (OSError, ValueError):
        calibration_hash, calibration_ready = None, False
    if version in ['source-face-v4', 'source-face-v5', 'source-face-v7', 'source-face-v8', 'source-face-v10'] and not calibration_ready:
        ready = False
        missing.append('Updated facial eye-calibration tools')
    try:
        eye_hash = profile_hash('source-face-v5')
        eye_ready = (calibration_ready and eye_python().is_file() and
                     json.loads((ROOT / 'state/eye-runtime-ready.json').read_text()).get('profileSHA256') == eye_hash and
                     json.loads((ROOT / 'state/eye-runtime-ready.json').read_text()).get('nativeBindingsVerified') is True)
    except (OSError, ValueError):
        eye_hash, eye_ready = None, False
    if version in ['source-face-v5', 'source-face-v8'] and eye_ready and verify:
        try:
            subprocess.run([str(eye_python()), '-c', 'import mediapipe;assert mediapipe.__version__=="1.2.0";'
                            'from mediapipe.tasks.python.core.mediapipe_c_bindings import load_raw_library;load_raw_library()'],
                           check=True, capture_output=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            eye_ready = False
    if version in ['source-face-v5', 'source-face-v8'] and not eye_ready:
        ready = False
        missing.append('Optional eye-finishing runtime')
    geometry_hashes = {name: profile_hash(name) for name in GEOMETRY_BASES}
    try:
        geometry_ready = cleanup_ready and json.loads(marker.read_text()).get('geometryProfiles') == geometry_hashes
    except (OSError, ValueError):
        geometry_ready = False
    if version in [*GEOMETRY_BASES, *BOUNDARY_BASES] and not geometry_ready:
        ready = False
        missing.append('Updated jaw-geometry tools')
    boundary_hashes = {name: profile_hash(name) for name in BOUNDARY_BASES}
    try:
        boundary_ready = (geometry_ready and json.loads(marker.read_text()).get('boundaryProfiles') == boundary_hashes and
                          json.loads(marker.read_text()).get('cleanupWorkerSHA256') == digest(ROOT / 'scripts/facial_worker.py'))
    except (OSError, ValueError):
        boundary_ready = False
    if version in BOUNDARY_BASES and not boundary_ready:
        ready = False
        missing.append('Updated face-boundary tools')
    return {'ready': not missing, 'runtimeReady': ready, 'missing': missing, 'profileSHA256': profile_hash(),
            'sceneProfileSHA256': scene_hash if scene_ready else None, 'cleanupProfileSHA256': cleanup_hash if cleanup_ready else None,
            'cleanupWorkerSHA256': json.loads(marker.read_text()).get('cleanupWorkerSHA256') if cleanup_ready else None,
            'calibrationProfileSHA256': calibration_hash if calibration_ready else None,
            'eyeFinishProfileSHA256': eye_hash if eye_ready else None,
            'geometryProfiles': geometry_hashes if geometry_ready else None,
            'boundaryProfiles': boundary_hashes if boundary_ready else None,
            'timingSHA256': timing_hash if timing_ready else None, 'bytes': manifest['total_bytes'] - ignored_bytes}


def write_ready_marker():
    marker = ROOT / 'state/runtime-ready.json'
    temporary = marker.with_suffix('.tmp.json')
    temporary.write_text(json.dumps({'profileSHA256': profile_hash(), 'sceneProfileSHA256': profile_hash('source-face-v2'),
                                     'cleanupProfileSHA256': profile_hash('source-face-v3'),
                                     'calibrationProfileSHA256': profile_hash('source-face-v4'),
                                     'geometryProfiles': {name: profile_hash(name) for name in GEOMETRY_BASES},
                                     'boundaryProfiles': {name: profile_hash(name) for name in BOUNDARY_BASES},
                                     'cleanupWorkerSHA256': digest(ROOT / 'scripts/facial_worker.py'),
                                     'timingSHA256': digest(ROOT / 'scripts/video_timing.py')}))
    temporary.replace(marker)


def link_models(model_root=None):
    source, _ = paths()
    folder = source / '.assets/models'
    if folder.is_symlink():
        raise ValueError('Unexpected linked FaceFusion model folder.')
    folder.mkdir(parents=True, exist_ok=True)
    for name in profile()['facefusion_models']:
        if is_content_filter_weight(name):
            continue
        target = (Path(model_root or MODEL_ROOT) / 'facefusion' / name).resolve()
        alias = folder / name
        if alias.is_symlink():
            if alias.resolve() != target:
                raise ValueError('A face-model alias points to another model set.')
        elif alias.exists():
            raise ValueError('An unexpected face-model file already exists; it was preserved.')
        else:
            alias.symlink_to(target)


def eye_python():
    return ROOT / '.local/eye-venv/bin/python'


def prepare_eye_runtime():
    """Explicit optional CPU observer environment; never alter the CUDA face venv."""
    python = eye_python()
    settings = json.loads((ROOT / 'config/facial-consistency-eye-finish.lock.json').read_text())
    if platform.machine() != 'x86_64':
        raise ValueError('The tested optional eye runtime requires an x86_64 managed host.')
    if shutil.disk_usage(ROOT).free < 5 * 1024**3 + settings['observation_runtime_reserve_bytes']:
        raise ValueError('Free the optional eye-runtime working reserve before preparation.')
    if not python.is_file():
        subprocess.run([str(paths()[1]), '-m', 'venv', str(python.parent.parent)], check=True)
    print('RECAST_FACIAL_STAGE Preparing isolated optional eye observer', flush=True)
    # The official CPU Tasks binary links these small GLVND loaders even when
    # its CPU delegate is selected. Check them before advertising readiness.
    import ctypes
    missing = []
    for library in ['libEGL.so.1', 'libGLESv2.so.2']:
        try:
            ctypes.CDLL(library)
        except OSError:
            missing.append(library)
    if missing:
        if shutil.which('apt-get') is None:
            raise ValueError('Install the EGL/GLES runtime libraries before preparing optional eye tools.')
        subprocess.run(['apt-get', 'update'], env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'}, check=True)
        subprocess.run(['apt-get', 'install', '-y', '--no-install-recommends', 'libegl1', 'libgles2'],
                       env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'}, check=True)
    subprocess.run([str(python), '-m', 'pip', 'install', '--only-binary=:all:', *settings['observation_runtime_packages']],
                   env={**os.environ, 'PIP_NO_CACHE_DIR': '1'}, check=True)
    subprocess.run([str(python), '-c', 'import mediapipe,cv2,numpy;assert mediapipe.__version__=="1.2.0";'
                    'from mediapipe.tasks.python.core.mediapipe_c_bindings import load_raw_library;load_raw_library()'], check=True)
    marker = ROOT / 'state/eye-runtime-ready.json'
    temporary = marker.with_suffix('.tmp.json')
    temporary.write_text(json.dumps({'profileSHA256': profile_hash('source-face-v5'), 'nativeBindingsVerified': True}))
    temporary.replace(marker)


def prepare(version='source-face-v1'):
    """Called only after an explicit download/update action, never Generate."""
    (ROOT / 'state').mkdir(parents=True, exist_ok=True)
    with (ROOT / 'state/runtime-setup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if inspect()['runtimeReady']:
            link_models()
            write_ready_marker()
            if version in ['source-face-v5', 'source-face-v8']:
                prepare_eye_runtime()
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
        write_ready_marker()
        if version in ['source-face-v5', 'source-face-v8']:
            prepare_eye_runtime()
        print('RECAST_FACIAL_STAGE Face tools prepared; model weights stay on demand', flush=True)
