#!/usr/bin/env python3
"""Optional CPU identity anchor. Setup is explicit; inference never downloads.

Uses a pinned, unmodified FaceFusion checkout. Its content filter is not
used. No identity embeddings or inferred demographic traits are persisted.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

from model_manifest import is_content_filter_weight

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'config/local-identity.lock.json'


def digest(file):
    value = hashlib.sha256()
    with open(file, 'rb') as handle:
        for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def locations():
    config = json.loads(LOCK.read_text())
    source = ROOT / config['source_directory']
    runtime = ROOT / config['venv_directory'] / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    return config, source, runtime


def status(verify=False):
    config, source, runtime = locations()
    missing = []
    try:
        revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL, timeout=5).decode().strip()
        clean = not subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain', '--untracked-files=no'], timeout=5).strip()
    except (OSError, subprocess.SubprocessError):
        revision, clean = None, False
    if revision != config['revision'] or not clean:
        missing.append('pinned FaceFusion source')
    if not runtime.is_file():
        missing.append('Python runtime')
    ready_bytes = 0
    required = [item for item in config['files'] if not is_content_filter_weight(item['path'])]
    for item in required:
        file = source / item['path']
        if not file.is_file() or file.stat().st_size != item['size'] or verify and digest(file) != item['sha256']:
            missing.append(Path(item['path']).name)
        else:
            ready_bytes += item['size']
    return {'ready': not missing, 'missing': missing, 'bytes': sum(item['size'] for item in required), 'readyBytes': ready_bytes,
            'location': 'local computer', 'setup': 'python3 scripts/local_identity.py setup', 'license': config['usage']}


def setup(python=None):
    config, source, runtime = locations()
    interpreter = python or shutil.which('python3.13') or str(Path.home() / '.local/bin/python3.13')
    if not Path(interpreter).is_file():
        raise ValueError('Install Python 3.13 first, or pass setup --python /path/to/python3.13.')
    if not source.exists():
        subprocess.run(['git', 'clone', '--filter=blob:none', '--no-checkout', config['repository'], str(source)], check=True)
        subprocess.run(['git', '-C', str(source), 'checkout', '--detach', config['revision']], check=True)
    else:
        revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD']).decode().strip()
        if revision != config['revision']:
            raise ValueError('Existing identity runtime has another revision. Preserve it and install the pinned checkout separately.')
    if not runtime.exists():
        subprocess.run([interpreter, '-m', 'venv', str(runtime.parent.parent)], check=True)
    subprocess.run([str(runtime), '-m', 'pip', 'install', *config['packages']], check=True)
    required = [item for item in config['files'] if not is_content_filter_weight(item['path'])]
    for index, item in enumerate(required):
        file = source / item['path']
        if file.is_file() and file.stat().st_size == item['size'] and digest(file) == item['sha256']:
            continue
        file.parent.mkdir(parents=True, exist_ok=True)
        partial = file.with_suffix(file.suffix + '.part')
        print(f"Downloading local identity file {index + 1}/{len(required)}: {file.name}", file=sys.stderr, flush=True)
        with urllib.request.urlopen(item['url'], timeout=60) as response, open(partial, 'wb') as target:
            shutil.copyfileobj(response, target, 4 * 1024 * 1024)
        if partial.stat().st_size != item['size'] or digest(partial) != item['sha256']:
            raise ValueError('Identity model checksum mismatch; partial file retained for inspection.')
        os.replace(partial, file)
    result = status(verify=True)
    if not result['ready']:
        raise ValueError('Local identity setup incomplete: ' + ', '.join(result['missing']))
    return result


def run(reference, target, output, mask=None):
    config, source, _ = locations()
    ready = status(verify=True)
    if not ready['ready']:
        raise ValueError('Local identity is not installed. Run ' + ready['setup'] + '. Nothing was downloaded or submitted to the GPU.')
    reference, target, output = Path(reference).resolve(), Path(target).resolve(), Path(output).resolve()
    mask = Path(mask).resolve() if mask else None
    if output.resolve() in [Path(reference).resolve(), Path(target).resolve()]:
        raise ValueError('Identity output must be separate from the original inputs.')
    signature = {'version': 1, 'profile': digest(LOCK), 'reference': digest(reference), 'target': digest(target), 'mask': digest(mask) if mask else None}
    receipt = output.with_suffix('.identity.json')
    if receipt.is_file() and output.is_file():
        saved = json.loads(receipt.read_text())
        if saved['inputs'] != signature or saved['output'] != digest(output):
            raise ValueError('Saved identity conditioning changed. Start a new job rather than changing a paid run.')
        return saved
    sys.path.insert(0, str(source))
    # Upstream processor discovery is relative to its checkout, not the app.
    os.chdir(source)
    import cv2
    import numpy as np
    from facefusion.program import create_program
    from facefusion.args import apply_args
    from facefusion import state_manager
    from facefusion.face_creator import get_static_faces
    from facefusion.processors.modules.face_swapper.core import swap_face
    args = vars(create_program().parse_args(['headless-run', '-s', str(reference), '-t', str(target), '-o', str(output),
        '--processors', 'face_swapper', '--face-swapper-model', 'hyperswap_1a_256', '--face-swapper-pixel-boost', '512x512',
        '--face-swapper-weight', '0.5', '--face-selector-mode', 'one', '--face-detector-model', 'yunet',
        '--face-mask-types', 'box', '--face-mask-blur', '0.3', '--execution-providers', 'cpu', '--execution-thread-count', '4']))
    apply_args(args, state_manager.init_item)
    # Verified weights only. An empty provider list blocks metadata probes
    # and implicit downloads. The content filter is not used.
    state_manager.init_item('download_providers', [])
    before = time.monotonic()
    donor, scene = cv2.imread(str(reference)), cv2.imread(str(target))
    if donor is None or scene is None:
        raise ValueError('A local identity input could not be decoded.')
    donors, targets = get_static_faces([donor]), get_static_faces([scene])
    if len(donors) != 1 or len(targets) != 1:
        raise ValueError('The local identity stage needs exactly one clear face in each image.')
    result = swap_face(donors[0], targets[0], donor, scene.copy())
    if mask:
        allowed = cv2.imread(str(mask), cv2.IMREAD_GRAYSCALE)
        if allowed is None:
            raise ValueError('The local identity edit mask could not be decoded.')
        allowed = cv2.resize(allowed, (scene.shape[1], scene.shape[0]), interpolation=cv2.INTER_LINEAR)
        alpha = allowed.astype(np.float32)[..., None] / 255
        result = np.rint(result * alpha + scene * (1 - alpha)).clip(0, 255).astype(np.uint8)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(output.stem + '.tmp.png')
    if not cv2.imwrite(str(temporary), result):
        raise ValueError('The local identity result could not be saved.')
    os.replace(temporary, output)
    saved = {'inputs': signature, 'output': digest(output), 'seconds': time.monotonic() - before,
             'model': 'hyperswap_1a_256', 'execution': 'local CPU'}
    receipt.write_text(json.dumps(saved, indent=2) + '\n')
    return saved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'setup', 'run'])
    parser.add_argument('--python')
    parser.add_argument('--reference')
    parser.add_argument('--target')
    parser.add_argument('--output')
    parser.add_argument('--mask')
    args = parser.parse_args()
    if args.action == 'status':
        result = status()
    elif args.action == 'setup':
        result = setup(args.python)
    else:
        if not all([args.reference, args.target, args.output]):
            raise ValueError('Reference, target and output are required.')
        result = run(args.reference, args.target, args.output, args.mask)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
