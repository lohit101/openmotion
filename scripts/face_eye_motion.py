"""Isolated CPU eye observation and bounded placement on the managed GPU host."""
import argparse
import json
import os
from pathlib import Path
import time

import cv2
import numpy as np

from facial_runtime import MODEL_ROOT, ROOT, digest, profile_hash
from face_eye_placement import EyePlaneObserver, retarget
from face_eye_temporal import temporal_source


def atomic(file, value):
    temporary = file.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(value) + '\n')
    temporary.replace(file)


def serialize(value):
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, dict):
        return {k: serialize(v) for k, v in value.items()}
    if isinstance(value, list):
        return [serialize(v) for v in value]
    return value


def eyes(value):
    return None if value is None else [{k: np.asarray(v, np.float32) if isinstance(v, list) else v for k, v in eye.items()} for eye in value]


def check_live(folder, parent):
    if (folder / 'result/CANCEL').exists():
        raise ValueError('Eye finishing cancelled; native and completed eye frames were kept.')
    if parent:
        try:
            command = Path(f'/proc/{parent}/cmdline').read_bytes()
        except OSError as error:
            raise ValueError('The owning facial worker stopped; eye processing was halted.') from error
        if b'facial_worker.py' not in command or folder.name.encode() not in command:
            raise ValueError('The owning facial worker changed; eye processing was halted.')


def update_progress(folder, completed, total, phase, frame, frames):
    value = {'completed': completed, 'total': total, 'phase': phase, 'phaseFrame': frame, 'phaseFrames': frames}
    atomic(folder / 'result/eye-finish/progress.json', value)
    print(json.dumps({'frame': completed, 'frames': total, 'stage': f'{phase} · {frame}/{frames} frames'}), flush=True)


def run(folder, parent):
    destination = folder / 'result/eye-finish'
    request = json.loads((destination / 'request.json').read_text())
    if request['profileSHA256'] != profile_hash('source-face-v5'):
        raise ValueError('Eye-finishing code or configuration changed; saved frames were kept.')
    native_file = folder / 'result/native-receipt.json'
    restoration_file = destination / 'restoration.json'
    if digest(native_file) != request['nativeReceiptSHA256']:
        raise ValueError('The frozen native facial receipt changed.')
    native = json.loads(native_file.read_text())
    restoration = json.loads(restoration_file.read_text())
    if not restoration['complete'] or restoration['inputs']['nativeReceiptSHA256'] != request['nativeReceiptSHA256']:
        raise ValueError('Eye restoration is incomplete or belongs to another native result.')
    info = native['inputs']['target']
    count = info['frames']
    if digest(folder / 'source.mp4') != native['inputs']['sourceSHA256']:
        raise ValueError('The chronological source video changed.')
    binding = {'requestSHA256': digest(destination / 'request.json'), 'restorationReceiptSHA256': digest(restoration_file),
               'profileSHA256': request['profileSHA256'], 'modelSHA256': request['observationModelSHA256']}
    observations_file = destination / 'observations.json'
    observations = json.loads(observations_file.read_text()) if observations_file.exists() else {'inputs': binding, 'complete': False, 'records': [], 'elapsedSeconds': 0}
    observations_complete = observations['complete']
    if observations['inputs'] != binding:
        raise ValueError('Eye observations belong to changed inputs; their saved state was preserved.')
    source = cv2.VideoCapture(str(folder / 'source.mp4'))
    observer = EyePlaneObserver(MODEL_ROOT / 'eye_finish/face_landmarker.task')
    start = time.monotonic()
    elapsed = observations['elapsedSeconds']
    try:
        for index in range(count):
            check_live(folder, parent)
            ok, original = source.read()
            if not ok:
                raise ValueError('The chronological source ended before its expected eye frame.')
            if index < len(observations['records']):
                if observations['records'][index]['frame'] != index:
                    raise ValueError('Eye observation resume order changed.')
                continue
            record = native['records'][index]
            restored_file = destination / 'restored' / f'frame-{index:06d}.png'
            if digest(restored_file) != restoration['records'][index]['sha256']:
                raise ValueError('A restored eye frame changed before observation.')
            row = {'frame': index, 'source': None, 'target': None, 'gates': [0, 0], 'action': 'preserved'}
            if record['action'] == 'refined':
                current = cv2.imread(str(restored_file))
                if current is None or current.shape != (info['height'], info['width'], 3):
                    raise ValueError('Invalid saved eye-restoration pixels.')
                if original.shape != current.shape:
                    original = cv2.resize(original, (info['width'], info['height']), interpolation=cv2.INTER_AREA)
                matrix = np.asarray(record['matrix'], np.float32)
                source_matrix = np.asarray(record['sourceMatrix'], np.float32)
                source_eyes = observer(cv2.warpAffine(original, source_matrix, (512, 512)))
                target_eyes = observer(cv2.warpAffine(current, matrix, (512, 512)))
                row.update(source=serialize(source_eyes), target=serialize(target_eyes), gates=record['cleanup']['sourceEyeGates'],
                           action='source-eye-plane-flow' if source_eyes is not None and target_eyes is not None else 'preserved')
            observations['records'].append(row)
            observations['elapsedSeconds'] = elapsed + time.monotonic() - start
            atomic(observations_file, observations)
            update_progress(folder, 2*count+index+1, 4*count, 'Observing source eye positions', index+1, count)
        if source.read()[0]:
            raise ValueError('Unexpected extra source eye frames; timing was not changed.')
    finally:
        source.release()
        observer.close()
    if not observations_complete:
        observations.update(complete=True, elapsedSeconds=elapsed+time.monotonic()-start)
        atomic(observations_file, observations)
    # The median uses only the coordinate residual, never another frame's RGB.
    temporal_records = []
    for row in observations['records']:
        points = []
        if row['action'] == 'source-eye-plane-flow':
            points = [{'side': side, 'sourceUV': row['source'][side]['uv'], 'targetUV': row['target'][side]['uv'],
                       'sourceOpenGate': row['gates'][side]} for side in range(2)]
        temporal_records.append({'action': row['action'], 'modes': {'current': {'eyes': points}}})
    receipt_file = destination / 'placement.json'
    placement_binding = {**binding, 'observationsSHA256': digest(observations_file)}
    saved = json.loads(receipt_file.read_text()) if receipt_file.exists() else {'inputs': placement_binding, 'complete': False, 'records': [], 'elapsedSeconds': 0}
    placement_complete = saved['complete']
    if saved['inputs'] != placement_binding:
        raise ValueError('Saved eye-placement state belongs to changed observations.')
    output = destination / 'frames'
    output.mkdir(exist_ok=True)
    start = time.monotonic()
    elapsed = saved['elapsedSeconds']
    strength = json.loads((ROOT / 'config/facial-consistency-eye-finish.lock.json').read_text())['placement_strength']
    for index, row in enumerate(observations['records']):
        check_live(folder, parent)
        if index < len(saved['records']):
            prior = saved['records'][index]
            if prior['frame'] != index or digest(output / f'frame-{index:06d}.png') != prior['sha256']:
                raise ValueError('A saved eye-placement frame changed.')
            continue
        restored_file = destination / 'restored' / f'frame-{index:06d}.png'
        if digest(restored_file) != restoration['records'][index]['sha256']:
            raise ValueError('A saved restored frame changed before placement.')
        frame = cv2.imread(str(restored_file))
        result = frame.copy()
        status = {'state': 'preserved', 'reason': 'uncertain-or-covered-face'}
        changed = 0
        if row['action'] == 'source-eye-plane-flow':
            record = native['records'][index]
            matrix = np.asarray(record['matrix'], np.float32)
            current = cv2.warpAffine(frame, matrix, (512, 512))
            driving, temporal = temporal_source(eyes(row['source']), eyes(row['target']), temporal_records, index, 'current')
            corrected, permission, status = retarget(current, driving, eyes(row['target']), row['gates'], strength)
            hard = cv2.warpAffine((permission > 0).astype(np.float32), cv2.invertAffineTransform(matrix),
                                  (info['width'], info['height']), flags=cv2.INTER_NEAREST)
            residual = cv2.warpAffine(corrected.astype(np.float32)-current, cv2.invertAffineTransform(matrix),
                                      (info['width'], info['height'])) * hard[..., None]
            result = np.rint(frame.astype(np.float32)+residual).clip(0, 255).astype(np.uint8)
            if not np.array_equal(result[hard == 0], frame[hard == 0]):
                raise ValueError('Eye placement changed protected scene pixels.')
            status.update(temporal=temporal, projectedProtectedPixelsExact=True, projectedPermissionPixels=int((hard > 0).sum()))
            changed = int(np.any(result != frame, axis=2).sum())
        file = output / f'frame-{index:06d}.png'
        temporary = file.with_name(file.stem+'.tmp.png')
        if not cv2.imwrite(str(temporary), result):
            raise ValueError('An eye-placement frame could not be saved.')
        temporary.replace(file)
        saved['records'].append({'frame': index, 'sha256': digest(file), 'protectedPixelsExact': True,
                                 'changedPixels': changed, 'placement': status})
        saved['elapsedSeconds'] = elapsed+time.monotonic()-start
        atomic(receipt_file, saved)
        update_progress(folder, 3*count+index+1, 4*count, 'Matching visible source glances', index+1, count)
    if not placement_complete:
        saved.update(complete=True, elapsedSeconds=elapsed+time.monotonic()-start)
        atomic(receipt_file, saved)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', nargs='?', type=Path)
    parser.add_argument('--parent', type=int)
    parser.add_argument('--check', type=Path)
    args = parser.parse_args()
    if args.check:
        observer = EyePlaneObserver(args.check)
        observer.close()
        print('EYE_OBSERVER_READY', flush=True)
    elif args.folder:
        run(args.folder.resolve(), args.parent)
    else:
        parser.error('Choose an owned job or an explicit model check.')


if __name__ == '__main__':
    main()
