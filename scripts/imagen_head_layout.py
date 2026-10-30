"""Image-space layout diagnostics, not 3-D pose or identity recognition.

The five YuNet points provide a roll angle and a coarse nose/eye asymmetry
cue. They never warp the replacement face or copy source facial proportions.
Keep this v1 policy frozen for saved body-only-v8/single-v3 image requests.
"""
import math


VERSION = 'source-head-layout-v1'
RECIPES = ('body-only-v8', 'body-only-single-v3')


def describe(faces, width, height):
    if len(faces) != 1:
        return {'version': VERSION, 'status': 'unavailable', 'reason': 'Expected one clearly visible source face.'}
    face = faces[0]
    box = face.get('bbox', [])
    if len(box) != 4 or not all(math.isfinite(float(v)) for v in box) or min(box[2:]) <= 0:
        return {'version': VERSION, 'status': 'unavailable', 'reason': 'Source face geometry is invalid.'}
    x, y, w, h = map(float, box)
    value = {'version': VERSION, 'status': 'available', 'bbox': [x, y, w, h],
             'canvas': [width, height], 'rollDegrees': None, 'noseOffset': None}
    points = face.get('landmarks')
    if min(w, h) >= 48 and points is not None and len(points) == 5 and all(len(p) == 2 and all(math.isfinite(float(v)) for v in p) for p in points):
        left, right = sorted(points[:2], key=lambda p: p[0])
        dx, dy = right[0] - left[0], right[1] - left[1]
        span = math.hypot(dx, dy)
        if dx > 0 and span >= max(8, w * .18):
            value['rollDegrees'] = math.degrees(math.atan2(dy, dx))
            # Project onto the eye axis so a simple head tilt is not a turn.
            eye_center = [(left[i] + right[i]) / 2 for i in (0, 1)]
            offset = ((points[2][0] - eye_center[0]) * dx + (points[2][1] - eye_center[1]) * dy) / span ** 2
            value['noseOffset'] = max(-1., min(1., offset))
    return value


def compare(source, output):
    if source.get('status') != 'available' or output.get('status') != 'available':
        return {'status': 'unavailable'}
    a, b = source['bbox'], output['bbox']
    width, height = source['canvas']
    result = {'status': 'available', 'faceSizeRatio': math.sqrt(b[2] * b[3] / (a[2] * a[3])),
              'faceHeightRatio': b[3] / a[3],
              'centerOffsetDiagonal': math.hypot(b[0] + b[2] / 2 - a[0] - a[2] / 2,
                                                b[1] + b[3] / 2 - a[1] - a[3] / 2) / math.hypot(width, height)}
    if source['rollDegrees'] is not None and output['rollDegrees'] is not None:
        result['rollDifferenceDegrees'] = abs((output['rollDegrees'] - source['rollDegrees'] + 90) % 180 - 90)
    if source['noseOffset'] is not None and output['noseOffset'] is not None:
        result['noseOffsetDifference'] = abs(output['noseOffset'] - source['noseOffset'])
    return result
