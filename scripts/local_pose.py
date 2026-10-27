#!/usr/bin/env python3
"""Explicit local DWPose setup and source-joint preparation; no inference downloads.

The user-painted person region replaces a separate person detector. The pinned
upstream Apache-2.0 ONNX decoder supplies 133 points; only 18 coarse body/head
joints are drawn, never source facial contours, hair or garment silhouettes.
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import shutil
import sys
import time
import urllib.request
from local_identity import digest

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'config/local-pose.lock.json'


def status(verify=False):
    config = json.loads(LOCK.read_text())
    missing = []
    for f in config['files']:
        p = ROOT / f['destination']
        if not p.is_file() or p.stat().st_size != f['size'] or verify and digest(p) != f['sha256']:
            missing.append(Path(f['destination']).name)
    return {'ready': not missing, 'missing': missing, 'bytes': config['total_bytes'], 'setup': 'python3 scripts/local_pose.py setup'}


def setup():
    for f in json.loads(LOCK.read_text())['files']:
        p = ROOT / f['destination']
        if p.is_file() and p.stat().st_size == f['size'] and digest(p) == f['sha256']:
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        partial = p.with_suffix(p.suffix + '.part')
        print('Downloading local pose dependency: ' + p.name, file=sys.stderr, flush=True)
        with urllib.request.urlopen(f['url'], timeout=60) as response, open(partial, 'wb') as target:
            shutil.copyfileobj(response, target, 4 * 1024 * 1024)
        if partial.stat().st_size != f['size'] or digest(partial) != f['sha256']:
            raise ValueError('Local pose dependency checksum mismatch; inference was not started.')
        os.replace(partial, p)
    return status(True)


def run(request, folder):
    ready = status(True)
    if not ready['ready']:
        raise ValueError('Install local pose preparation first: ' + ready['setup'] + '. No GPU job was submitted.')
    import cv2
    import numpy as np
    import onnxruntime as ort
    spec = importlib.util.spec_from_file_location('pinned_dwpose_decoder', ROOT / '.local/pose-runtime/onnxpose.py')
    decoder = importlib.util.module_from_spec(spec); spec.loader.exec_module(decoder)
    image, mask = cv2.imread(request['source']), cv2.imread(request['mask'], cv2.IMREAD_GRAYSCALE)
    reference = cv2.imread(request['reference'])
    if image is None or mask is None or reference is None:
        raise ValueError('Pose inputs could not be decoded.')
    mask = cv2.resize(mask, image.shape[1::-1], interpolation=cv2.INTER_NEAREST)
    x, y, width, height = cv2.boundingRect((mask > 8).astype(np.uint8))
    if width < 32 or height < 32:
        raise ValueError('Paint a complete person region before preparing its pose.')
    options = ort.SessionOptions(); options.intra_op_num_threads = 4; options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(ROOT / '.local/pose-runtime/pose.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    start = time.monotonic()
    points, scores = decoder.inference_pose(session, np.array([[x, y, x + width, y + height]]), image)
    points, scores = points[0], scores[0]
    neck = (points[5] + points[6]) / 2
    candidates = np.vstack([points[0], neck, points[[6, 8, 10, 5, 7, 9, 12, 14, 16, 11, 13, 15, 2, 1, 4, 3]]])
    confidence = np.r_[scores[0], min(scores[5], scores[6]), scores[[6, 8, 10, 5, 7, 9, 12, 14, 16, 11, 13, 15, 2, 1, 4, 3]]]
    valid = (confidence >= .5) & (candidates[:, 0] >= 0) & (candidates[:, 0] < image.shape[1]) & (candidates[:, 1] >= 0) & (candidates[:, 1] < image.shape[0])
    clipped = []
    # A cropped elbow can lie a few pixels outside the decoded frame. Draw its
    # boundary contact, while rejecting low-confidence/invisible wrists/legs.
    for index in (3, 6):
        px, py = candidates[index]
        if confidence[index] >= .5 and -.02 * image.shape[1] <= px <= image.shape[1] * 1.02 and 0 <= py < image.shape[0]:
            valid[index] = True
            if px < 0 or px >= image.shape[1]: clipped.append(index)
    drawing = candidates.copy(); drawing[:,0] = drawing[:,0].clip(0,image.shape[1]-1)
    if not all(valid[[0, 1, 2, 5]]):
        raise ValueError('Source nose and both shoulders were not detected confidently. Choose a clearer frame or disable pose guidance.')
    g = request['geometry']
    canvas = np.zeros((g['height'], g['width'], 3), np.uint8)
    coordinates = drawing * [g['contentWidth'] / image.shape[1], g['contentHeight'] / image.shape[0]] + [g['x'], g['y']]
    # Standard OpenPose RGB limb palette; write BGR with OpenCV below.
    colors = [(255,0,0),(255,85,0),(255,170,0),(255,255,0),(170,255,0),(85,255,0),(0,255,0),(0,255,85),(0,255,170),(0,255,255),(0,170,255),(0,85,255),(0,0,255),(85,0,255),(170,0,255),(255,0,255),(255,0,170),(255,0,85)]
    limbs = [(1,2),(1,5),(2,3),(3,4),(5,6),(6,7),(1,8),(8,9),(9,10),(1,11),(11,12),(12,13),(1,0),(0,14),(14,16),(0,15),(15,17)]
    stick = max(3, round(g['width'] / 256))
    for i, (a,b) in enumerate(limbs):
        if not valid[a] or not valid[b]: continue
        p, q = coordinates[a], coordinates[b]
        center = tuple(np.rint((p + q) / 2).astype(int))
        polygon = cv2.ellipse2Poly(center, (max(1, round(np.linalg.norm(p - q) / 2)), stick), round(math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))), 0, 360, 1)
        cv2.fillConvexPoly(canvas, polygon, colors[i])
    canvas = (canvas * .6).astype(np.uint8)
    for i, point in enumerate(coordinates):
        if valid[i]: cv2.circle(canvas, tuple(np.rint(point).astype(int)), stick, colors[i], -1)
    folder = Path(folder); folder.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(folder / 'source-pose.png'), canvas[:, :, ::-1])
    # Preserve actual donor anatomy and hair. A tested portrait segmentation
    # mask clipped the forehead, so it is not used as generation conditioning.
    from image_replacement import padded
    cv2.imwrite(str(folder / 'body-appearance.png'), padded(reference, 590000, 32))
    receipt = {'profile':digest(LOCK), 'source':digest(request['source']), 'reference':digest(request['reference']), 'mask':digest(request['mask']), 'seconds':time.monotonic()-start, 'points':candidates.tolist(), 'confidence':confidence.tolist(), 'visible':valid.tolist(), 'clippedElbows':clipped, 'sourcePose':digest(folder/'source-pose.png'), 'bodyAppearance':digest(folder/'body-appearance.png')}
    (folder / 'pose-preparation.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return {'visibleJoints':int(valid.sum()), 'seconds':receipt['seconds']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['status','setup','run']); parser.add_argument('--request'); parser.add_argument('--folder'); args=parser.parse_args()
    try:
        result = status() if args.action == 'status' else setup() if args.action == 'setup' else run(json.loads(Path(args.request).read_text()), args.folder)
        print(json.dumps(result))
    except (ValueError, OSError) as error:
        print(str(error),file=sys.stderr);sys.exit(1)
