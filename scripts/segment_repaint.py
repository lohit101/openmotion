#!/usr/bin/env python3
"""Extract the exact raw appearance frame and a bounded face scope. No inference/downloads."""
import argparse
import json
import math
from pathlib import Path
import struct
import sys

from image_replacement import atomic_json, atomic_png, dependencies, detect, sha256


def appearance_frame(anchor, expected):
    cv2, np = dependencies()
    anchor = Path(anchor)
    with anchor.open('rb') as file:
        prefix = file.read(8)
        if len(prefix) != 8:
            raise ValueError('The raw continuation anchor is incomplete. Resume its saved download; no segment will be generated again.')
        length = struct.unpack('<Q', prefix)[0]
        if not 2 <= length <= 16_000_000:
            raise ValueError('The raw continuation header is invalid.')
        header = json.loads(file.read(length))
    meta = header.get('__metadata__', {})
    version = expected.get('contextVersion', 'last-frame-v2')
    if version not in ('last-frame-v2', 'encoded-overlap-v3'):
        raise ValueError('This appearance continuation version is unsupported.')
    values = {'version': version, 'job_id': expected['jobId'], 'width': str(expected['width']), 'height': str(expected['height']), 'count': '1' if version == 'encoded-overlap-v3' else '5',
              'source_anchor_frame': str(expected['skip']), 'source_end_frame': str(expected['skip'] + expected['overlap']), 'reference_source_frame': str(expected['skip'] + expected['overlap'] - 1)}
    if expected['overlap'] < 5 or float(meta.get('fps', -1)) != 24 or any(meta.get(k) != v for k, v in values.items()):
        raise ValueError('The appearance anchor does not match this job, frame range or canvas. No image or video was submitted.')
    def tensor_pixels(name, count):
        tensor = header.get(name)
        shape = [count, expected['height'], expected['width'], 3]
        if not tensor or tensor.get('dtype') != 'F32' or tensor.get('shape') != shape:
            raise ValueError('The exact previous raw appearance frame is missing. An encoded video frame will not be substituted.')
        offsets = tensor.get('data_offsets', [])
        size = math.prod(shape) * 4
        if len(offsets) != 2 or any(type(v) is not int or v < 0 for v in offsets) or offsets[1] - offsets[0] != size or 8 + length + offsets[1] > anchor.stat().st_size:
            raise ValueError('The continuation pixel tensor is incomplete or invalid.')
        pixels = np.memmap(anchor, dtype='<f4', mode='r', offset=8 + length + offsets[0], shape=shape)
        if not np.isfinite(pixels).all():
            raise ValueError('The raw appearance frame contains invalid pixels.')
        return pixels
    if version == 'encoded-overlap-v3':
        pixels = tensor_pixels('reference_frame', 1)[0].copy()
    else:
        frames = tensor_pixels('frames', 5)
        pixels = (frames[-1] if expected['overlap'] == 5 else tensor_pixels('reference_frame', 1)[0]).copy()
    # Match ComfyUI SaveImage's float RGB → uint8 conversion exactly.
    rgb = np.clip(pixels * 255.0, 0, 255).astype(np.uint8)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def face_scope(image, model):
    cv2, np = dependencies()
    faces = detect(image, model)
    if len(faces) > 1:
        raise ValueError('More than one face is visible at this boundary. The next segment is paused to avoid repainting the wrong character.')
    if not faces:
        return None, 'No clear face is visible at this boundary; the exact raw frame is carried forward without inventing a visible face.'
    face = faces[0]
    x, y, width, height = face['bbox']
    confidence = face.get('confidence', face.get('score', 0))
    if confidence < .9 or min(width, height) < 32:
        return None, 'The visible face is too small or uncertain for an identity refresh; the exact raw appearance frame is retained.'
    mask = np.zeros(image.shape[:2], np.uint8)
    cv2.ellipse(mask, (round(x + width / 2), round(y + height * .4)), (max(1, round(width * .78)), max(1, round(height * .85))), 0, 0, 360, 255, -1)
    mask = cv2.GaussianBlur(mask, (0, 0), max(1, height * .015))
    rows = np.arange(image.shape[0], dtype=np.float32)[:, None]
    gate = np.clip((y + height * 1.13 - rows) / max(1, height * .08), 0, 1)
    return np.rint(mask.astype(np.float32) * gate).astype(np.uint8), None


def prepare(anchor, expected, folder, model):
    folder = Path(folder); folder.mkdir(parents=True, exist_ok=True)
    signature = {'anchorSHA256': sha256(anchor), **expected}
    receipt = folder / 'target-receipt.json'
    if receipt.exists():
        old = json.loads(receipt.read_text())
        if old['inputs'] != signature or any(not (folder / name).is_file() or sha256(folder / name) != digest for name, digest in old['outputs'].items()):
            raise ValueError('The saved segment repaint inputs changed. Existing paid work remains intact.')
        return old
    image = appearance_frame(anchor, expected)
    mask, warning = face_scope(image, model)
    atomic_png(folder / 'target.png', image)
    outputs = {'target.png': sha256(folder / 'target.png')}
    if mask is not None:
        atomic_png(folder / 'scope-mask.png', mask); outputs['scope-mask.png'] = sha256(folder / 'scope-mask.png')
    result = {'inputs': signature, 'outputs': outputs, 'warning': warning, 'repaint': mask is not None}
    atomic_json(receipt, result)
    return result


def main():
    parser = argparse.ArgumentParser()
    for name in ['anchor', 'job', 'folder', 'model']: parser.add_argument('--' + name, required=True)
    for name in ['width', 'height', 'skip', 'overlap']: parser.add_argument('--' + name, required=True, type=int)
    parser.add_argument('--context-version', choices=['last-frame-v2', 'encoded-overlap-v3'])
    args = parser.parse_args()
    expected = {'jobId': args.job, 'width': args.width, 'height': args.height, 'skip': args.skip, 'overlap': args.overlap}
    if args.context_version:
        expected['contextVersion'] = args.context_version
    print(json.dumps(prepare(args.anchor, expected, args.folder, args.model)))


if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, KeyError, struct.error) as error:
        print(str(error), file=sys.stderr); sys.exit(1)
