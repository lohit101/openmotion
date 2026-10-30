"""Separately versioned eye calibration; frozen v1/v2/v3 code stays unchanged."""
import hashlib
import json

import numpy as np

from face_feature_cleanup import eye_areas, smooth
from face_performance import compose_expression, pose_rotation, tensor_image

EYES = (27, 28, 29, 30, 34, 35, 47, 48)
JAW = (44, 45, 46)


def _points(value):
    value = np.asarray(value, np.float32)
    if value.size != 147 or not np.isfinite(value).all():
        raise ValueError('Invalid facial calibration motion.')
    return value.reshape(1, 49, 3)


def matching_pose(first, second):
    """The same eye/nose normalized pose gate used by facial frame matching."""
    def pose(points):
        points = np.asarray(points, np.float32)
        if points.shape != (5, 2) or not np.isfinite(points).all():
            raise ValueError('Invalid facial anchor landmarks.')
        eyes = points[1] - points[0]
        distance = float(np.linalg.norm(eyes))
        if distance < 1:
            raise ValueError('Degenerate facial anchor landmarks.')
        h = eyes / distance
        nose = (points[2] - (points[0] + points[1]) / 2) / distance
        return np.array([nose @ h, nose @ np.array([-h[1], h[0]])])
    return bool(np.all(np.abs(pose(first) - pose(second)) <= [.25, .35]))


class EyeCalibration:
    """Copy source performance while excluding reference mouth/jaw/eye-X bias."""
    def __init__(self, reference_motion, anchor_motion, anchor_labels, eligible_eyes):
        if not isinstance(eligible_eyes, (list, tuple)) or len(eligible_eyes) != 2 or any(type(v) is not bool for v in eligible_eyes):
            raise ValueError('Invalid anchor-eye eligibility.')
        if not any(eligible_eyes):
            raise ValueError('At least one visible anchor eye is required for calibration.')
        anchor = _points(anchor_motion['exp'])
        self.offset = _points(reference_motion['exp']) - anchor
        self.offset[:, :8] = 0
        self.offset[:, JAW] = 0
        self.offset[:, EYES, 0] = 0
        canonical = (_points(anchor_motion['kp']) + anchor)[0]
        ordered = sorted(EYES, key=lambda index: canonical[index, 0])
        self.eye_groups = [ordered[:4], ordered[4:]]
        self.eligible_eyes = list(eligible_eyes)
        for indices, eligible in zip(self.eye_groups, eligible_eyes):
            if not eligible:
                self.offset[:, indices] = 0
        self.eye_baseline = np.maximum(100, eye_areas(anchor_labels))

    def describe(self):
        return {'eyeGroups': self.eye_groups, 'eligibleEyes': self.eligible_eyes,
                'baselineEyeAreas': self.eye_baseline.tolist(),
                'correctionSHA256': hashlib.sha256(self.offset.tobytes()).hexdigest()}

    def freeze(self):
        return {**self.describe(), 'offset': self.offset.tolist()}

    @classmethod
    def restore(cls, value):
        obj = cls.__new__(cls)
        obj.offset = _points(value['offset']).copy()
        groups, eligible = value['eyeGroups'], value['eligibleEyes']
        if not isinstance(groups, list) or len(groups) != 2 or any(not isinstance(g, list) or len(g) != 4 for g in groups) or sorted(groups[0] + groups[1]) != sorted(EYES):
            raise ValueError('Saved calibration eye groups changed.')
        if any(type(i) is not int for g in groups for i in g) or not isinstance(eligible, list) or len(eligible) != 2 or not any(eligible) or any(type(v) is not bool for v in eligible):
            raise ValueError('Saved calibration eye eligibility changed.')
        obj.eye_groups, obj.eligible_eyes = groups, eligible
        obj.eye_baseline = np.asarray(value['baselineEyeAreas'], np.float32)
        if obj.eye_baseline.shape != (2,) or not np.isfinite(obj.eye_baseline).all() or np.any(obj.eye_baseline < 100):
            raise ValueError('Saved calibration eye baseline changed.')
        if np.any(obj.offset[:, :8]) or np.any(obj.offset[:, JAW]) or np.any(obj.offset[:, EYES, 0]):
            raise ValueError('Saved calibration changed mouth, jaw or horizontal eye expression.')
        for indices, visible in zip(groups, eligible):
            if not visible and np.any(obj.offset[:, indices]):
                raise ValueError('Saved calibration edits a hidden anchor eye.')
        if obj.describe()['correctionSHA256'] != value['correctionSHA256']:
            raise ValueError('Saved calibration motion checksum changed.')
        return obj

    def apply(self, source_expression, target_expression, source_labels):
        source, target = _points(source_expression), _points(target_expression)
        weights = smooth((eye_areas(source_labels) / self.eye_baseline - .12) / .88)
        correction = self.offset.copy()
        for i, indices in enumerate(self.eye_groups):
            if not self.eligible_eyes[i]:
                weights[i] = 0
            correction[:, indices, 1] *= weights[i]
        desired = compose_expression(target, source + correction, False)
        baseline = compose_expression(target, source, False)
        if not np.array_equal(desired[:, :8], source[:, :8]) or not np.array_equal(desired[:, JAW], baseline[:, JAW]):
            raise ValueError('Eye calibration changed frozen source mouth/jaw performance.')
        return desired, {'eyeCalibrationWeights': weights.tolist(),
                         'sourceMouthLatentUnchanged': True, 'sourceJawLatentUnchanged': True}


class EyeCalibratedModels:
    """Adapter for the unchanged v3 compositor; same CUDA models and donor."""
    def __init__(self, models, parser, calibration):
        self.models, self.parser, self.calibration = models, parser, calibration
        self.last = None

    def correct(self, driver, target, permission, regional):
        if regional:
            raise ValueError('This frozen calibration recipe is Standard only.')
        m = self.models
        source = m.infer('motion', {'image': tensor_image(driver, 256)})
        motion = m.infer('motion', {'image': tensor_image(target, 256)})
        kp, exp = [_points(motion[k]) for k in ['kp', 'exp']]
        desired, self.last = self.calibration.apply(source['exp'], exp, self.parser(driver))
        rotation = pose_rotation(motion)
        scale = motion['scale'][:, None, :]
        translation = motion['t'].copy()[:, None, :]
        translation[:, :, 2] = 0
        original = ((kp + exp) @ rotation.T) * scale + translation
        driven = ((kp + desired) @ rotation.T) * scale + translation
        feature = m.infer('appearance', {'source_image': tensor_image(target, 512)}, True)['feature_3d']
        warped = m.infer('warp', {'feature_3d': feature, 'kp_driving': driven, 'kp_source': original}, True)['out']
        pixels = m.infer('decode', {'feature': warped})['out'][0]
        if pixels.shape != (3, 512, 512) or not np.isfinite(pixels).all():
            raise ValueError('The calibrated facial model returned invalid pixels.')
        expression = np.clip(pixels.transpose(1, 2, 0) * 255, 0, 255).astype(np.uint8)[:, :, ::-1]
        identity = m.identity(expression, permission)
        return np.rint(.6 * identity + .4 * expression).clip(0, 255).astype(np.uint8)


def _save_calibration(file, value):
    temporary = file.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(value) + '\n')
    temporary.replace(file)

def prepare_eye_calibration(folder, models, parser, request, inputs, info, detect_face):
    """Freeze one exact chronological source anchor; reuse it on face resume."""
    import cv2
    import hashlib
    from facial_runtime import digest
    import numpy as np
    from facefusion.face_helper import warp_face_by_face_landmark_5
    from face_feature_cleanup import source_eye_gates
    from face_performance import tensor_image
    index = request.get('anchorFrame')
    if type(index) is not int or not 0 <= index < info['frames'] or request['profile'] != 'perform-onnx60':
        raise ValueError('Invalid frozen Standard eye-calibration anchor.')
    capture = cv2.VideoCapture(str(folder / 'source.mp4'))
    try:
        for _ in range(index + 1):
            ok, original = capture.read()
            if not ok:
                raise ValueError('The exact source anchor could not be decoded; no alternate frame was selected.')
    finally:
        capture.release()
    frame_hash = hashlib.sha256(original.tobytes()).hexdigest()
    binding = {'jobId': request['jobId'], 'version': request['version'], 'profileSHA256': request['profileSHA256'],
               'anchorFrame': index, 'sourceSHA256': inputs['sourceSHA256'], 'referenceSHA256': inputs['referenceSHA256']}
    destination = folder / 'result/calibration.json'
    allowed_skips = ['anchor-face-uncertain', 'reference-face-uncertain', 'anchor-reference-pose-mismatch', 'anchor-eyes-not-visible']
    if destination.is_symlink():
        raise ValueError('Saved calibration must be a regular owned file.')
    if destination.exists():
        saved = json.loads(destination.read_text())
        if saved['binding'] != binding or saved['metadata']['anchorBGRSHA256'] != frame_hash:
            raise ValueError('The saved source-anchor calibration changed; face frames were kept.')
        metadata = saved['metadata']
        if metadata['state'] == 'active':
            calibration = EyeCalibration.restore(saved['model'])
            if any(metadata.get(k) != v for k, v in calibration.describe().items()):
                raise ValueError('Saved facial calibration metadata changed.')
            selected = EyeCalibratedModels(models, parser, calibration)
        elif metadata['state'] == 'skipped' and metadata.get('reason') in allowed_skips and saved['model'] is None:
            selected = models
        else:
            raise ValueError('Invalid saved facial calibration state.')
        return selected, {**binding, **metadata, 'fileSHA256': digest(destination)}
    metadata = {'state': 'skipped', 'reason': 'anchor-face-uncertain', 'anchorBGRSHA256': frame_hash}
    selected, calibration = models, None
    if original.shape[:2] != (info['height'], info['width']):
        original = cv2.resize(original, (info['width'], info['height']), interpolation=cv2.INTER_AREA)
    reference = cv2.imread(str(folder / 'reference.png'))
    source_face, ref_face = detect_face(original), detect_face(reference)
    if source_face is not None:
        if ref_face is None:
            metadata['reason'] = 'reference-face-uncertain'
        elif not matching_pose(source_face[1], ref_face[1]):
            metadata['reason'] = 'anchor-reference-pose-mismatch'
        else:
            driver, sm = warp_face_by_face_landmark_5(original, source_face[1], 'arcface_128', (512, 512))
            ref_crop, rm = warp_face_by_face_landmark_5(reference, ref_face[1], 'arcface_128', (512, 512))
            source_labels, ref_labels = parser(driver), parser(ref_crop)
            source_points = cv2.transform(source_face[2].reshape(1, 68, 2), sm)[0]
            ref_points = cv2.transform(ref_face[2].reshape(1, 68, 2), rm)[0]
            source_gates, ref_gates = source_eye_gates(source_labels, source_points), source_eye_gates(ref_labels, ref_points)
            eligible = [bool(s >= .25 and r >= .25) for s, r in zip(source_gates, ref_gates)]
            metadata.update(sourceAnchorEyeGates=source_gates, referenceEyeGates=ref_gates)
            if any(eligible):
                calibration = EyeCalibration(models.infer('motion', {'image': tensor_image(ref_crop, 256)}),
                    models.infer('motion', {'image': tensor_image(driver, 256)}), source_labels, eligible)
                metadata.update(state='active', reason=None, **calibration.describe())
                selected = EyeCalibratedModels(models, parser, calibration)
            else:
                metadata['reason'] = 'anchor-eyes-not-visible'
    _save_calibration(destination, {'binding': binding, 'metadata': metadata, 'model': calibration.freeze() if calibration else None})
    return selected, {**binding, **metadata, 'fileSHA256': digest(destination)}
