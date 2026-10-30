#!/usr/bin/env python3
"""Face finishing on an already connected rental; never rent/resume compute."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

import vast
from managed_models import check_connection
from managed_video_identity import sync
from video_identity import video_info

ROOT = Path(__file__).resolve().parents[1]


def digest(file):
    from facial_runtime import digest as sha
    return sha(file)


def fingerprint(version='source-face-v1'):
    from facial_runtime import profile_hash
    return profile_hash(version)


def remote_root(config):
    return Path(config['remote_root']) / 'facial-runtime'


def call(config, action, job=None, capture=True, version=None):
    root = remote_root(config)
    python = root / '.local/face-venv/bin/python' if action == 'preflight' else Path('python3')
    command = [str(python), str(root / 'scripts/facial_worker.py'), action]
    if job:
        command += ['--job', job]
    if version:
        command += ['--version', version]
    try:
        value = vast.remote(config, command, capture_output=capture, text=True)
    except subprocess.CalledProcessError as error:
        if error.stderr:
            print(error.stderr[-3000:], file=sys.stderr)
        raise
    if not capture:
        return None
    rows = [line[14:] for line in value.stdout.splitlines() if line.startswith('RECAST_FACIAL ')]
    if not rows:
        raise ValueError('The facial worker returned no status receipt.')
    return json.loads(rows[-1])


def launch(config, job):
    try:
        call(config, 'launch', job)
    except subprocess.CalledProcessError:
        # A rejected launch is terminal only if the exact saved worker confirms
        # it is stopped. Missing or unreadable status remains protected.
        try:
            state = call(config, 'poll', job)
            if state.get('running') is False:
                print('RECAST_FACIAL_STOPPED', flush=True)
        except (ValueError, OSError, subprocess.SubprocessError):
            pass
        raise


def prepare_memory(config, job, phase):
    # Run the small admission helper before CUDA initialization, including when
    # recovering an older paid recipe. It is independent of recipe fingerprints.
    source = (ROOT / 'scripts/facial_memory.py').read_text()
    try:
        value = vast.remote(config, ['python3', '-c', source, str(remote_root(config)), job, phase],
                            capture_output=True, text=True)
    except subprocess.CalledProcessError as error:
        try:
            if call(config, 'poll', job).get('running') is False:
                print('RECAST_FACIAL_STOPPED', flush=True)
        except (ValueError, OSError, subprocess.SubprocessError):
            pass
        raise ValueError((error.stderr or 'Could not verify free GPU memory before facial processing. Saved video was kept.')[-2000:]) from None
    result = json.loads(value.stdout)
    print('RECAST_FACIAL_MEMORY ' + json.dumps(result), flush=True)
    return result


def upload_runtime(config):
    root = remote_root(config)
    names = ['scripts/download_models.py', 'scripts/facial_runtime.py', 'scripts/facial_worker.py', 'scripts/video_timing.py', 'scripts/face_performance.py', 'scripts/scene_face_composite.py', 'scripts/face_feature_cleanup.py', 'scripts/face_eye_calibration.py',
             'config/facial-consistency-runtime.lock.json', 'config/facial-consistency-models.lock.json', 'config/facial-consistency-scene.lock.json',
             'config/facial-consistency-cleanup.lock.json', 'config/facial-consistency-cleanup-models.lock.json', 'config/facial-consistency-eye.lock.json', 'config/server.json',
             'config/facial-consistency-eye-finish.lock.json', 'config/facial-consistency-eye-finish-models.lock.json',
             'scripts/face_eye_finish.py', 'scripts/face_eye_motion.py', 'scripts/face_eye_placement.py', 'scripts/face_eye_temporal.py']
    with tempfile.TemporaryFile() as stream:
        with tarfile.open(fileobj=stream, mode='w:gz') as archive:
            for name in names:
                archive.add(ROOT / name, arcname=name, recursive=False)
        stream.seek(0)
        code = '''import tarfile,pathlib,sys,tempfile,shutil,os
r=pathlib.Path(sys.argv[1])
if r.is_symlink():raise ValueError('Unexpected linked runtime root')
r.mkdir(parents=True,exist_ok=True)
stage=pathlib.Path(tempfile.mkdtemp(prefix='.runtime-upload-',dir=r))
try:
 names=[]
 with tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz')as a:
  for m in a:
   p=pathlib.Path(m.name)
   if p.is_absolute()or'..'in p.parts or not m.isfile():raise ValueError('Unsafe runtime archive')
   dest=r/p
   if dest.is_symlink()or any((r/parent).is_symlink()for parent in p.parents):raise ValueError('Unexpected linked runtime file')
   a.extract(m,stage,filter='data');names.append(p)
 for p in names:
  (r/p).parent.mkdir(parents=True,exist_ok=True)
  os.replace(stage/p,r/p)
finally:shutil.rmtree(stage)
'''
        vast.remote(config, ['python3', '-c', code, str(root)], stdin=stream)


def prepare_runtime(config, version='source-face-v1'):
    upload_runtime(config)
    call(config, 'prepare', capture=False, version=version)


def status(config, version='source-face-v1'):
    exists = subprocess.run(vast.ssh_arguments(config) + ['-T', vast.destination(config),
        'test -f ' + str(remote_root(config) / 'scripts/facial_worker.py')], capture_output=True)
    if exists.returncode:
        return {'ready': False, 'runtimeReady': False, 'missing': ['Facial runtime'], 'profileSHA256': fingerprint()}
    value = call(config, 'status', version=version)
    if value.get('profileSHA256') != fingerprint():
        value.update(ready=False, runtimeReady=False, missing=[*value.get('missing', []), 'Updated facial tools'])
    if version == 'source-face-v2' and value.get('sceneProfileSHA256') != fingerprint(version):
        value.update(ready=False, runtimeReady=False, missing=[*value.get('missing', []), 'Updated scene-face tools'])
    if version == 'source-face-v3' and value.get('cleanupProfileSHA256') != fingerprint(version):
        value.update(ready=False, runtimeReady=False, missing=[*value.get('missing', []), 'Updated facial feature-cleanup tools'])
    if version in ['source-face-v3', 'source-face-v4', 'source-face-v5'] and value.get('cleanupWorkerSHA256') != digest(ROOT / 'scripts/facial_worker.py'):
        value.update(ready=False, runtimeReady=False, missing=[*value.get('missing', []), 'Updated facial-processing worker'])
    if version in ['source-face-v4', 'source-face-v5'] and value.get('calibrationProfileSHA256') != fingerprint('source-face-v4'):
        value.update(ready=False, runtimeReady=False, missing=[*value.get('missing', []), 'Updated eye-calibration tools'])
    if version == 'source-face-v5' and value.get('eyeFinishProfileSHA256') != fingerprint(version):
        value.update(ready=False, runtimeReady=False, missing=[*value.get('missing', []), 'Optional eye-finishing tools'])
    if value.get('timingSHA256') != digest(ROOT / 'scripts/video_timing.py'):
        value.update(ready=False, runtimeReady=False, missing=[*value.get('missing', []), 'Updated frame-timing tools'])
    return value


def facial_input_info(config, job, target, source):
    try:
        # The frozen Remotion contract supplies 24 fps. Actual decoded PTS must
        # match it, even when a short stream-copy join reports a wrong average.
        target_info = video_info(target, expected_fps=24)
        source_info = video_info(source, expected_fps=24)
        if target_info['frames'] != source_info['frames'] or target_info['fps'] != source_info['fps']:
            raise ValueError('Source and generated frame timing differ. No facial processing was submitted.')
        return target_info, source_info
    except (ValueError, OSError, subprocess.SubprocessError):
        # A local validation failure is not an unknown live GPU task. Only clear
        # that flag after independently checking the saved remote worker.
        try:
            state = call(config, 'poll', job)
            if state.get('running') is False:
                print('RECAST_FACIAL_STOPPED', flush=True)
        except (ValueError, OSError, subprocess.SubprocessError):
            pass
        raise


def write_request(config, folder, file, data):
    with tempfile.TemporaryDirectory() as temporary:
        local = Path(temporary) / file
        local.write_text(json.dumps(data))
        # A frozen request must never be changed by resuming another recipe.
        code = '''import pathlib,json,sys
p=pathlib.Path(sys.argv[1]);expected=json.loads(sys.argv[2])
if p.exists()and json.loads(p.read_text())!=expected:raise ValueError('Saved facial inputs/settings changed; existing output was preserved')
'''
        vast.remote(config, ['python3', '-c', code, str(folder / file), json.dumps(data)])
        sync(config, str(local), str(folder / file))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--instance-id', type=int, required=True)
    parser.add_argument('--action', choices=['status', 'prepare', 'preflight', 'run', 'cancel'], required=True)
    parser.add_argument('--job')
    parser.add_argument('--profile', choices=['perform-onnx60', 'regional-onnx60'])
    parser.add_argument('--version', choices=['source-face-v1', 'source-face-v2', 'source-face-v3', 'source-face-v4', 'source-face-v5'], default='source-face-v1')
    parser.add_argument('--anchor-frame', type=int)
    parser.add_argument('--reference')
    parser.add_argument('--target')
    parser.add_argument('--source')
    parser.add_argument('--output')
    parser.add_argument('--frames', type=int)
    parser.add_argument('--width', type=int)
    parser.add_argument('--height', type=int)
    args = parser.parse_args()
    config = vast.load()
    check_connection(config, args.instance_id)
    os.environ['RECAST_SSH_BATCH'] = '1'
    cancelled = False
    def cancel(_signal, _frame):
        nonlocal cancelled
        cancelled = True
    signal.signal(signal.SIGTERM, cancel)
    signal.signal(signal.SIGINT, cancel)
    if args.action == 'status':
        print('RECAST_FACIAL ' + json.dumps(status(config, args.version)), flush=True)
        return
    if args.action == 'prepare':
        prepare_runtime(config, args.version)
        return
    job = str(uuid.UUID(args.job))
    folder = remote_root(config) / 'jobs' / job
    if args.action == 'cancel':
        for _ in range(45):
            value = call(config, 'cancel', job)
            if not value['running']:
                print('RECAST_FACIAL_STOPPED', flush=True)
                return
            time.sleep(1)
        raise ValueError('Facial cancellation is not confirmed. Reconnect the same instance to check it.')
    tools = status(config, args.version)
    if not tools['ready']:
        raise ValueError('Prepare the selected facial tools beside Advanced settings. Nothing was downloaded by Generate.')
    if not args.reference or not args.profile:
        raise ValueError('The fixed facial reference and selected profile are required.')
    reference = Path(args.reference).resolve()
    vast.remote(config, ['mkdir', '-p', str(folder)])
    request = {'jobId': job, 'profile': args.profile, 'profileSHA256': fingerprint(args.version), 'referenceSHA256': digest(reference),
               'expected': {'frames': args.frames, 'width': args.width, 'height': args.height}}
    if args.version != 'source-face-v1':
        request['version'] = args.version
    if args.version in ['source-face-v4', 'source-face-v5']:
        if args.profile != 'perform-onnx60' or args.anchor_frame is None or not 0 <= args.anchor_frame < args.frames:
            raise ValueError('The frozen Standard source-anchor frame is required for eye calibration.')
        request['anchorFrame'] = args.anchor_frame
    write_request(config, folder, 'request.json', request)
    sync(config, str(reference), str(folder / 'reference.png'))
    if args.action == 'preflight':
        if cancelled:
            print('RECAST_FACIAL_STOPPED\nRECAST_FACIAL_CANCELLED', flush=True)
            raise ValueError('Facial reference check cancelled before GPU submission.')
        prepare_memory(config, job, 'preflight')
        if cancelled:
            print('RECAST_FACIAL_STOPPED\nRECAST_FACIAL_CANCELLED', flush=True)
            raise ValueError('Facial reference check cancelled before GPU submission.')
        try:
            value = call(config, 'preflight', job)
        except subprocess.CalledProcessError as error:
            if error.returncode != 255:
                print('RECAST_FACIAL_STOPPED', flush=True)
            if error.stderr:
                print(error.stderr[-2000:], file=__import__('sys').stderr)
            raise
        print('RECAST_FACIAL_STOPPED', flush=True)
        if cancelled:
            print('RECAST_FACIAL_CANCELLED', flush=True)
            raise ValueError('Facial reference check cancelled before video sampling.')
        print('RECAST_FACIAL ' + json.dumps(value), flush=True)
        return
    if not args.target or not args.source or not args.output:
        raise ValueError('Frozen source, rendered video and separate output folder are required.')
    target, source, output = Path(args.target).resolve(), Path(args.source).resolve(), Path(args.output).resolve()
    if output in [target, source, reference] or output in target.parents or output in source.parents:
        raise ValueError('Keep corrected output separate from its immutable inputs.')
    output.mkdir(parents=True, exist_ok=True)
    target_info, source_info = facial_input_info(config, job, target, source)
    inputs = {'request': request, 'target': target_info, 'source': source_info, 'baseSHA256': digest(target),
              'sourceSHA256': digest(source), 'referenceSHA256': digest(reference)}
    write_request(config, folder, 'inputs.json', inputs)
    sync(config, str(target), str(folder / 'target.mp4'))
    sync(config, str(source), str(folder / 'source.mp4'))
    if cancelled:
        print('RECAST_FACIAL_STOPPED', flush=True)
        print('RECAST_FACIAL_CANCELLED', flush=True)
        raise ValueError('Facial processing cancelled before GPU submission.')
    prepare_memory(config, job, 'run')
    if cancelled:
        print('RECAST_FACIAL_STOPPED\nRECAST_FACIAL_CANCELLED', flush=True)
        raise ValueError('Facial processing cancelled before GPU submission.')
    launch(config, job)
    sent = False
    while True:
        if cancelled and not sent:
            call(config, 'cancel', job)
            sent = True
        value = call(config, 'poll', job)
        if value.get('frames'):
            print(json.dumps({'frame': value.get('frame', 0), 'frames': value['frames'], 'stage': value.get('stage', 'Matching source expressions and facial identity')}), flush=True)
        if not value['running'] and value['state'] in ['completed', 'interrupted']:
            print('RECAST_FACIAL_STOPPED', flush=True)
            if cancelled:
                print('RECAST_FACIAL_CANCELLED', flush=True)
                raise ValueError('Facial processing cancelled; saved frames and rendered video remain.')
            if value['state'] == 'interrupted':
                raise ValueError(value.get('error', 'Facial processing was interrupted; its saved frames remain.'))
            break
        time.sleep(1)
    names = ['final.mp4', 'receipt.json', *(['calibration.json'] if args.version in ['source-face-v4', 'source-face-v5'] else [])]
    if args.version == 'source-face-v5':
        names += ['native-receipt.json', 'eye-finish/request.json', 'eye-finish/restoration.json', 'eye-finish/observations.json', 'eye-finish/placement.json']
    for name in names:
        (output / name).parent.mkdir(parents=True, exist_ok=True)
        sync(config, str(folder / 'result' / name), str(output / name), download=True)
    receipt = json.loads((output / 'receipt.json').read_text())
    if not receipt.get('complete') or receipt['inputs'] != {**inputs, 'version': args.version} or digest(output / 'final.mp4') != receipt['outputSHA256']:
        raise ValueError('Facial-result provenance/checksum failed. The remote result is kept for recovery.')
    if args.version in ['source-face-v4', 'source-face-v5'] and digest(output / 'calibration.json') != receipt.get('calibration', {}).get('fileSHA256'):
        raise ValueError('The saved eye calibration failed checksum validation. Existing output was kept.')
    if args.version == 'source-face-v5':
        eye = receipt.get('eyeFinish', {})
        expected = {'native-receipt.json': eye.get('nativeReceiptSHA256'), 'eye-finish/request.json': eye.get('requestSHA256'),
                    'eye-finish/restoration.json': eye.get('restorationReceiptSHA256'), 'eye-finish/observations.json': eye.get('observationReceiptSHA256'),
                    'eye-finish/placement.json': eye.get('placementReceiptSHA256')}
        if not eye.get('complete') or any(digest(output / name) != value for name, value in expected.items()):
            raise ValueError('The saved optional-eye receipts failed checksum validation. Remote output was preserved.')
    (output / 'transport.json').write_text(json.dumps({'jobId': job, 'instanceId': args.instance_id, 'receiptSHA256': digest(output / 'receipt.json')}))
    print('RECAST_FACIAL ' + json.dumps({key: value for key, value in receipt.items() if key != 'records'}), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=__import__('sys').stderr)
        raise SystemExit(1)
