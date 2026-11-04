"""Versioned selective repair primitives, separate from frozen facial recipes.

All intervals are half-open on the parent's original 24 fps frame clock.  A
repair may read context anywhere, but may only write its displayed editable
intervals.  This module performs no setup, network access or model inference.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import uuid

VERSION = 'face-repair-v1'
FILES = ('scripts/face_repair.py', 'scripts/face_repair_worker.py')
PARENTS = ('source-face-v7', 'source-face-v8', 'source-face-v10', 'source-face-v11')
GOALS = ('auto', 'identity', 'boundary')


def fingerprint(parent_version):
    from facial_runtime import ROOT, profile_hash
    if parent_version not in PARENTS:
        raise ValueError('This saved facial recipe is not supported by selective repair.')
    data = bytes.fromhex(profile_hash(parent_version)) + bytes.fromhex(profile_hash('source-face-v11'))
    return hashlib.sha256(data + b''.join((ROOT / name).read_bytes() for name in FILES)).hexdigest()


def canonical_hash(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def validate_ranges(ranges, frames, fps=24):
    if type(frames) is not int or not 1 <= frames <= 720 or fps != 24:
        raise ValueError('Repair requires the original, unmodified 24 fps Remotion clock.')
    if not isinstance(ranges, list) or not 1 <= len(ranges) <= 12:
        raise ValueError('Choose between one and twelve repair intervals.')
    normalized = []
    prior_end = -1
    handles = math.floor(fps * .25)
    for value in ranges:
        keys = ('startFrame', 'endFrame', 'editableStartFrame', 'editableEndFrame')
        if not isinstance(value, dict) or any(type(value.get(k)) is not int for k in keys):
            raise ValueError('Repair intervals must contain whole frame indices.')
        start, end, left, right = (value[k] for k in keys)
        if not 0 <= left <= start < end <= right <= frames or start < prior_end:
            raise ValueError('Repair intervals overlap, are unordered or exceed the parent video.')
        if start-left > handles or right-end > handles:
            raise ValueError('Visible repair handles may extend at most 0.25 seconds per side.')
        normalized.append({k: value[k] for k in keys})
        prior_end = end
    return normalized


def temporal_weight(index, ranges):
    """Smooth intervention with exact zero at the displayed outer handles.

    At a clip edge there is no neighbouring accepted footage to match, so a
    selection touching that edge starts/ends at full strength.  Overlapping
    handles combine by maximum and never multiply/darken the correction.
    """
    def smooth(x):
        x = min(1., max(0., x))
        return x*x*(3-2*x)
    weight = 0.
    for r in ranges:
        a, b, left, right = (r[k] for k in ('startFrame', 'endFrame', 'editableStartFrame', 'editableEndFrame'))
        if not left <= index < right:
            continue
        current = 1.
        if index < a:
            current *= smooth((index-left) / max(1, a-left))
        if index >= b:
            current *= smooth((right-1-index) / max(1, right-b))
        weight = max(weight, current)
    return weight


def selected_frames(ranges):
    return sorted({i for r in ranges for i in range(r['editableStartFrame'], r['editableEndFrame'])
                   if temporal_weight(i, ranges) > 0})


def validate_request(request):
    from facial_runtime import profile_hash
    if request.get('version') != VERSION or request.get('goal') not in GOALS:
        raise ValueError('This repair goal is not yet validated or its saved version changed.')
    for key in ('jobId', 'parentJobId', 'rootJobId'):
        if str(uuid.UUID(request[key])) != request[key]:
            raise ValueError('Repair and parent identifiers must be canonical UUIDs.')
    if request['jobId'] in (request['parentJobId'],request['rootJobId']):
        raise ValueError('A repair must be a separate revision, never its parent.')
    if request['parent']['version'] not in PARENTS or request['parent']['profile'] != 'perform-onnx60':
        raise ValueError('Choose a completed Standard facial finish before repairing this video.')
    parent_version = request['parent']['version']
    for key in ('finishedSHA256', 'rawSHA256', 'sourceSHA256', 'referenceSHA256',
                'parentReceiptSHA256', 'parentCalibrationSHA256', 'parentProfileSHA256', 'profileSHA256'):
        h = request['binding'].get(key)
        if not isinstance(h, str) or len(h) != 64 or any(c not in '0123456789abcdef' for c in h):
            raise ValueError('A frozen repair input checksum is invalid: ' + key)
    if request['binding']['parentProfileSHA256'] != profile_hash(parent_version):
        raise ValueError('The parent facial recipe differs from the installed frozen tools.')
    if request['binding']['profileSHA256'] != fingerprint(parent_version):
        raise ValueError('The saved repair recipe differs from the installed repair tools.')
    if any(type(request.get(k)) is not int or not 64 <= request[k] <= 4096 for k in ('width', 'height')):
        raise ValueError('Invalid repair dimensions.')
    validate_ranges(request['ranges'], request['frames'], request['fps'])
    if type(request['parent'].get('anchorFrame')) is not int or not 0 <= request['parent']['anchorFrame'] < request['frames']:
        raise ValueError('The parent source calibration anchor is missing.')
    inherited = request.get('inheritance', {})
    for key in ('parentJobId', 'parentReceiptSHA256', 'parentCalibrationSHA256'):
        expected = request['rootJobId'] if key == 'parentJobId' else request['binding'][key]
        if inherited.get(key) != expected:
            raise ValueError('The parent calibration inheritance record changed.')
    return request


def composite_layer(parent, prediction, permission, veto, weight):
    """One absolute face plane on canonical finished pixels, foreground last."""
    import numpy as np
    parent, prediction = np.asarray(parent), np.asarray(prediction)
    permission, veto = np.asarray(permission, np.float32), np.asarray(veto, np.float32)
    if parent.dtype != np.uint8 or parent.ndim != 3 or parent.shape[2] != 3 or prediction.shape != parent.shape:
        raise ValueError('Invalid canonical repair scene or predicted face plane.')
    if permission.shape != parent.shape[:2] or veto.shape != permission.shape:
        raise ValueError('Invalid repair permission or foreground dimensions.')
    if not all(np.isfinite(x).all() for x in (prediction, permission, veto)) or not 0 <= weight <= 1:
        raise ValueError('Non-finite repair pixels or strength.')
    if np.any((permission < 0) | (permission > 1)) or np.any((veto < 0) | (veto > 1)):
        raise ValueError('Repair permissions must stay within zero and one.')
    alpha = permission * (1-veto) * weight
    result = np.rint(prediction*alpha[..., None] + parent*(1-alpha[..., None])).clip(0, 255).astype(np.uint8)
    if not np.array_equal(result[alpha == 0], parent[alpha == 0]):
        raise ValueError('Repair altered a protected canonical pixel.')
    return result, alpha


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['fingerprint'])
    parser.add_argument('--parent-version', required=True, choices=PARENTS)
    args = parser.parse_args()
    print(fingerprint(args.parent_version))
