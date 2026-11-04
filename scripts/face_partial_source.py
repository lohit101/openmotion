"""Versioned array-only partial-source eye ownership. No model or media I/O.

Constants are copied from the reviewed private v2 prototype. Mirroring this
compositor verifies ownership math, never neural-model equivariance or quality.
Source203 geometry is an estimate; a computed clear mask is not groundtruth.
The selected SOURCE image-side is mapped to the same TARGET crop image-side.
This is an assumption, not an independently observed full source-face pose gate
or anatomical-eye correspondence guarantee through extreme turns. Two clear
eyes with an occluded mouth are intentionally unsupported by this single-eye API.
"""
import cv2
import numpy as np

from pathlib import Path
import hashlib
import json

_POLICY_FILE = Path(__file__).resolve().parents[1] / 'config/facial-consistency-occlusion.lock.json'
SETTINGS = json.loads(_POLICY_FILE.read_text())
FROZEN_POLICY = SETTINGS['partial_eye']
POLICY_SHA256 = hashlib.sha256(_POLICY_FILE.read_bytes()).hexdigest()


def _plane(value, shape, name):
    value = np.asarray(value, np.float32)
    if value.shape != shape or not np.isfinite(value).all() or np.any((value < 0) | (value > 1)):
        raise ValueError('Invalid ' + name)
    return value


def admit_visible_eye(source203, source_hand_mask, source_affine,
                      source_primary_detected, target_primary_valid, *,
                      track_valid=True, source_mask_state='segmented'):
    """Admit exactly one computed-clear source eye after real facial overlap.

    The two203 eye groups are sorted spatially, not assigned an anatomical
    side. No manual visibility/event/closure labels or reference frame enter.
    More than one clear eye is explicitly ambiguous for this single-eye policy.
    """
    decision = {'admitted': False, 'selectedImageEye': None,
                'manualLabelsUsed': False, 'physicalVisibilityProven': False,
                'sourceToTargetImageSideCorrespondenceAssumed': True,
                'independentFullSourceFacePoseGateAvailable': False}
    if source_primary_detected:
        return {**decision, 'reason': 'primary-source-route-retained'}
    if not target_primary_valid:
        return {**decision, 'reason': 'target-primary-unavailable'}
    if track_valid is not True:
        return {**decision, 'reason': 'source-track-unavailable'}
    if source_mask_state != 'segmented' or source_hand_mask is None:
        return {**decision, 'reason': 'source-hand-mask-unavailable'}
    mask = np.asarray(source_hand_mask, bool)
    points = np.asarray(source203, np.float32)
    matrix = np.asarray(source_affine, np.float64)
    if mask.ndim != 2 or points.shape != (203, 2) or matrix.shape != (2, 3):
        return {**decision, 'reason': 'invalid-tracked-shape'}
    if not np.isfinite(points).all() or not np.isfinite(matrix).all():
        return {**decision, 'reason': 'nonfinite-track'}
    if abs(float(np.linalg.det(matrix[:, :2]))) < 1e-8:
        return {**decision, 'reason': 'degenerate-track'}
    height, width = mask.shape
    groups = sorted([points[:24], points[24:48]], key=lambda p: float(p[:, 0].mean()))
    blocked = cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    coverage, raw_coverage, outside, eye_widths = [], [], [], []
    for group in groups + [points[48:108]]:
        raster = np.zeros(mask.shape, np.uint8)
        polygon = np.rint(cv2.convexHull(group.astype(np.float32))).astype(np.int32)
        cv2.fillConvexPoly(raster, polygon, 1)
        raw_coverage.append(float(mask[raster > 0].mean()) if raster.any() else 0.)
        raster = cv2.dilate(raster, np.ones((3, 3), np.uint8))
        coverage.append(float(blocked[raster > 0].mean()) if raster.any() else 0.)
        outside.append(bool(np.any((group[:, 0] < 0) | (group[:, 0] >= width) |
                                   (group[:, 1] < 0) | (group[:, 1] >= height))))
        eye_widths.append(float(np.ptp(group[:, 0])))
    scale = float(np.hypot(matrix[0, 0], matrix[1, 0]))
    inverse = cv2.invertAffineTransform(matrix)
    corners = cv2.transform(np.array([[[0., 0.], [511., 0.], [511., 511.], [0., 511.]]]), inverse)[0]
    bounded = bool(.05 <= scale <= 32 and np.all(corners[:, 0] >= -width) and
                   np.all(corners[:, 0] <= 2 * width) and np.all(corners[:, 1] >= -height) and
                   np.all(corners[:, 1] <= 2 * height))
    decision.update(rawHandCoverageEyesMouth=raw_coverage,
                    dilatedHandCoverageEyesMouth=coverage, sourceEyeOutside=outside[:2],
                    sourceEyeWidths=eye_widths[:2], sourceCropScale=scale, trackedROIBounded=bounded)
    if not bounded:
        return {**decision, 'reason': 'unbounded-track'}
    if not any(x > 0 for x in coverage):
        return {**decision, 'reason': 'no-source-facial-hand-overlap'}
    candidates = [i for i in range(2) if coverage[i] == 0 and not outside[i] and eye_widths[i] >= 4]
    if len(candidates) == 0:
        return {**decision, 'reason': 'no-clear-in-frame-eye'}
    if len(candidates) != 1:
        return {**decision, 'reason': 'ambiguous-multiple-clear-eyes'}
    selected = ['image-left', 'image-right'][candidates[0]]
    return {**decision, 'admitted': True, 'selectedImageEye': selected,
            'reason': 'unique-computed-clear-eye-with-facial-overlap'}


def compose_orbital(scene, raw_crop, predicted_crop, raw_labels, predicted_labels,
                    xseg, target_affine, target68, target_veto, selected_image_eye):
    """Apply only one swept orbital residual, with unchanged XSeg/veto last."""
    scene = np.asarray(scene)
    raw = np.asarray(raw_crop)
    prediction = np.asarray(predicted_crop)
    if scene.ndim != 3 or scene.shape[2] != 3 or scene.dtype != np.uint8:
        raise ValueError('Invalid scene')
    if raw.shape != (512, 512, 3) or prediction.shape != raw.shape or raw.dtype != np.uint8 or prediction.dtype != np.uint8:
        raise ValueError('Invalid model crops')
    if selected_image_eye not in ['image-left', 'image-right']:
        return scene.copy(), {'edited': False, 'reason': 'no-admitted-eye'}, np.zeros(scene.shape[:2], np.float32)
    labels = [np.asarray(v) for v in [raw_labels, predicted_labels]]
    if any(v.shape != (512, 512) or not np.issubdtype(v.dtype, np.integer) for v in labels):
        raise ValueError('Invalid semantic labels')
    raw_labels, pred_labels = labels
    matrix = np.asarray(target_affine, np.float64)
    landmark = np.asarray(target68, np.float32)
    if matrix.shape != (2, 3) or landmark.shape != (68, 2) or not np.isfinite(matrix).all() or not np.isfinite(landmark).all():
        raise ValueError('Invalid detected target geometry')
    if abs(float(np.linalg.det(matrix[:, :2]))) < 1e-8:
        raise ValueError('Degenerate detected target geometry')
    xseg = _plane(xseg, (512, 512), 'XSeg ceiling')
    veto = _plane(target_veto, scene.shape[:2], 'target veto')
    points = cv2.transform(landmark[None], matrix)[0]
    eyes = sorted([points[36:42], points[42:48]], key=lambda p: float(p[:, 0].mean()))
    eye = eyes[0 if selected_image_eye == 'image-left' else 1]
    W = float(np.ptp(eye[:, 0]))
    if W <= 0:
        raise ValueError('Degenerate detected target eye')
    yy, xx = np.mgrid[:512, :512]
    mid = float((eyes[0][:, 0].mean() + eyes[1][:, 0].mean()) / 2)
    side = xx < mid if selected_image_eye == 'image-left' else xx > mid
    base = ((np.isin(raw_labels, [4, 5]) | np.isin(pred_labels, [4, 5])) & side).astype(np.uint8)
    cv2.fillConvexPoly(base, np.rint(eye).astype(np.int32), 1)
    radius = max(1, round(.4 * W))
    swept = cv2.dilate(base, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))) > 0
    bounds = ((xx >= eye[:, 0].min() - .5 * W) & (xx <= eye[:, 0].max() + .5 * W) &
              (yy >= eye[:, 1].min() - .55 * W) & (yy <= eye[:, 1].max() + .35 * W))
    excluded = np.isin(raw_labels, [2, 3, 11, 12, 13]) | np.isin(pred_labels, [2, 3, 11, 12, 13])
    allowed = swept & bounds & ~excluded
    feather = np.clip(cv2.distanceTransform(allowed.astype(np.uint8), cv2.DIST_L2, 5) / max(1, .1 * W), 0, 1)
    feather = feather * feather * (3 - 2 * feather)
    alpha = np.minimum(feather, xseg)
    inverse = cv2.invertAffineTransform(matrix)
    geometry = (scene.shape[1], scene.shape[0])
    permission = cv2.warpAffine(alpha, inverse, geometry).clip(0, 1)
    hard = cv2.warpAffine(allowed.astype(np.float32), inverse, geometry, flags=cv2.INTER_NEAREST) > 0
    excluded_scene = cv2.warpAffine(excluded.astype(np.float32), inverse, geometry, flags=cv2.INTER_NEAREST) > 0
    permission *= hard & ~excluded_scene
    permission *= veto
    delta = cv2.warpAffine(prediction.astype(np.float32) - raw, inverse, geometry)
    result = np.rint(scene.astype(np.float32) + permission[..., None] * delta).clip(0, 255).astype(np.uint8)
    if not np.array_equal(result[~hard | excluded_scene | (veto == 0)], scene[~hard | excluded_scene | (veto == 0)]):
        raise ValueError('Protected scene pixels changed')
    return result, {'edited': True, 'selectedImageEye': selected_image_eye,
                    'targetEyeWidth': W, 'changedPixels': int(np.any(result != scene, axis=2).sum()),
                    'rawPredictedBrowMouthAndOutsideSupportExact': True, 'targetVetoZeroExact': True,
                    'sourceRGBTransferred': False, 'qualityClaimed': False}, permission


def apply_visible_eye_policy(*, source203, source_hand_mask, source_affine,
                             source_primary_detected, target_primary_valid,
                             scene, raw_crop, predicted_crop, raw_labels, predicted_labels,
                             xseg, target_affine, target68, target_veto,
                             track_valid=True, source_mask_state='segmented'):
    admission = admit_visible_eye(source203, source_hand_mask, source_affine,
                                  source_primary_detected, target_primary_valid,
                                  track_valid=track_valid, source_mask_state=source_mask_state)
    result, detail, permission = compose_orbital(scene, raw_crop, predicted_crop, raw_labels,
                                                predicted_labels, xseg, target_affine, target68,
                                                target_veto, admission['selectedImageEye'])
    return result, {'admission': admission, 'compositor': detail}, permission


def _hash_binding(value):
    data = {k: v for k, v in value.items() if k != 'sha256'}
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':'),
                                     allow_nan=False).encode()).hexdigest()


def _source_identity(source_sha, track_id, shot_id, frame_count):
    if not isinstance(source_sha, str) or len(source_sha) != 64 or any(c not in '0123456789abcdef' for c in source_sha):
        raise ValueError('Invalid source tracking SHA256.')
    if not isinstance(track_id, str) or not track_id or not isinstance(shot_id, str) or not shot_id:
        raise ValueError('A source track and shot binding are required.')
    if type(frame_count) is not int or not 1 <= frame_count <= 720:
        raise ValueError('Invalid source track frame count.')


def _affine(value):
    value = np.asarray(value, np.float64)
    if value.shape != (2, 3) or not np.isfinite(value).all() or np.linalg.det(value[:, :2]) <= 1e-8:
        raise ValueError('Invalid source tracking affine.')
    singular = np.linalg.svd(value[:, :2], compute_uv=False)
    if singular[0] / singular[1] > 1.00001:
        raise ValueError('Source tracking requires a proper similarity crop.')
    return value


def choose_clear_anchor(candidates, *, missing_span, frame_count, source_sha, track_id, shot_id):
    """Choose one real primary observation nearest a missing span, never neutral.

    Candidate keys: frame/sourceSHA256/trackId/shotId/primaryValid/clear/ambiguous.
    The controller establishes those observations; this function cannot certify
    neutral expression or person identity. A tie uses the earlier source frame.
    """
    _source_identity(source_sha, track_id, shot_id, frame_count)
    if not isinstance(missing_span, (tuple, list)) or len(missing_span) != 2:
        raise ValueError('Invalid partial source range.')
    start, end = missing_span
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= frame_count:
        raise ValueError('Invalid partial source range.')
    qualified = []
    for row in candidates:
        if not isinstance(row, dict):
            continue
        i = row.get('frame')
        if type(i) is not int or not 0 <= i < frame_count:
            continue
        if (row.get('sourceSHA256') != source_sha or row.get('trackId') != track_id or
                row.get('shotId') != shot_id or row.get('primaryValid') is not True or
                row.get('clear') is not True or row.get('ambiguous') is not False):
            continue
        distance = start - i if i < start else i - end + 1 if i >= end else 0
        qualified.append((distance, i, row))
    return dict(min(qualified, key=lambda x: (x[0], x[1]))[2]) if qualified else None


def freeze_alignment(anchor_arc5, anchor203, *, source_sha, track_id, shot_id,
                     anchor_frame, frame_count, existing=None):
    """Freeze a single203-to-Arc5 chart for a track; resume never swaps it."""
    _source_identity(source_sha, track_id, shot_id, frame_count)
    if type(anchor_frame) is not int or not 0 <= anchor_frame < frame_count:
        raise ValueError('Invalid clear source anchor frame.')
    arc, dense = _affine(anchor_arc5), _affine(anchor203)
    hom = lambda m: np.vstack([m, [0., 0., 1.]])
    cross = hom(arc) @ np.linalg.inv(hom(dense))
    value = {'version': SETTINGS['version'], 'policySHA256': POLICY_SHA256,
             'sourceSHA256': source_sha, 'trackId': track_id, 'shotId': shot_id,
             'anchorFrame': anchor_frame, 'frameCount': frame_count,
             'anchorArc5': arc.tolist(), 'anchor203': dense.tolist(), 'cross': cross.tolist()}
    value['sha256'] = _hash_binding(value)
    if existing is not None and existing != value:
        raise ValueError('The frozen source track anchor changed; cached results were preserved.')
    return value


def tracked_arc5(official203, binding, *, source_sha, track_id, shot_id, frame_count):
    _source_identity(source_sha, track_id, shot_id, frame_count)
    expected = {'version': SETTINGS['version'], 'policySHA256': POLICY_SHA256,
                'sourceSHA256': source_sha, 'trackId': track_id, 'shotId': shot_id,
                'frameCount': frame_count}
    if not isinstance(binding, dict) or any(binding.get(k) != v for k, v in expected.items()):
        raise ValueError('The source track belongs to a different input, shot or policy.')
    if binding.get('sha256') != _hash_binding(binding):
        raise ValueError('The frozen source tracking binding changed.')
    # Reconstructing the binding also validates its anchor and affine contents.
    freeze_alignment(binding['anchorArc5'], binding['anchor203'], source_sha=source_sha,
                     track_id=track_id, shot_id=shot_id, anchor_frame=binding['anchorFrame'],
                     frame_count=frame_count, existing=binding)
    dense = _affine(official203)
    mapped = np.asarray(binding['cross'], np.float64) @ np.vstack([dense, [0., 0., 1.]])
    return _affine(mapped[:2])


def foreground_veto(mask, shape=None, state='segmented'):
    """Final target-scene permission. Unknown ownership preserves all raw RGB."""
    if mask is not None:
        value = np.asarray(mask)
        if value.ndim != 2 or not np.isfinite(value).all():
            raise ValueError('Invalid target foreground mask.')
        if shape is not None and tuple(shape) != value.shape:
            raise ValueError('Target foreground mask dimensions changed.')
        shape = value.shape
    if not isinstance(shape, (tuple, list)) or len(shape) != 2 or any(type(v) is not int or v < 1 for v in shape):
        raise ValueError('Target foreground dimensions are required.')
    if state == 'known-none':
        if mask is not None and np.any(mask):
            raise ValueError('Known-none target ownership has a positive hand mask.')
        return np.ones(shape, np.float32), np.zeros(shape, bool)
    if state != 'segmented' or mask is None:
        return np.zeros(shape, np.float32), np.ones(shape, bool)
    hand = np.asarray(mask, bool)
    hard = cv2.dilate(hand.astype(np.uint8), cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (SETTINGS['target_veto']['dilation_pixels'],) * 2)) > 0
    alpha = np.clip(cv2.distanceTransform((~hard).astype(np.uint8), cv2.DIST_L2, 5) /
                    SETTINGS['target_veto']['feather_scene_pixels'], 0, 1)
    return alpha * alpha * (3 - 2 * alpha), hard


def apply_scene_veto(scene, result, veto):
    """Veto a generated residual last. Never paste source-actor RGB."""
    scene, result = np.asarray(scene), np.asarray(result)
    if scene.dtype != np.uint8 or result.dtype != np.uint8 or scene.shape != result.shape or scene.ndim != 3 or scene.shape[2] != 3:
        raise ValueError('Invalid foreground scene inputs.')
    alpha = _plane(veto, scene.shape[:2], 'target scene veto')
    value = np.rint(scene.astype(np.float32) + alpha[..., None] *
                   (result.astype(np.float32) - scene)).clip(0, 255).astype(np.uint8)
    if not np.array_equal(value[alpha == 0], scene[alpha == 0]):
        raise ValueError('Target foreground protection changed raw scene pixels.')
    return value
