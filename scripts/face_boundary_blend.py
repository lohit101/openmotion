"""Finite inward face-boundary blending, preserving the accepted performance.

Uses existing semantic/occlusion permission, with no new model or reference.
Source performance features and a newly supported speaking chin retain their
existing ownership. Lighting correction is confined to the peripheral band.
"""
import json
from pathlib import Path

import cv2
import numpy as np

from face_feature_cleanup import (FEATURE_CLASSES, _alpha, _image, _labels, match_lighting,
                                  restore_eye_detail, source_eye_gates)
from face_jaw_geometry import jaw_masks

SETTINGS = json.loads((Path(__file__).resolve().parents[1] / 'config/facial-consistency-boundary.lock.json').read_text())


def _smooth(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def boundary_plane(raw, edited, alpha, labels, scale, jaw_support=None, strength=SETTINGS['strength']):
    raw = _image(raw)
    alpha = _alpha(alpha)
    edited = np.asarray(edited, np.float32)
    labels = _labels(labels)
    if edited.shape != raw.shape or not np.isfinite(edited).all() or np.any((edited < 0) | (edited > 255)):
        raise ValueError('Invalid boundary blend inputs.')
    if not np.isfinite(scale) or not .05 <= scale <= 32 or not np.isfinite(strength) or not 0 <= strength <= 1:
        raise ValueError('Invalid boundary blend scale or strength.')
    # Preserve complete eye/brow/nose/mouth features. Never fade a feature into
    # another identity while softening the outer cheek/hair transition.
    owned = np.isin(labels, (*FEATURE_CLASSES, 10)).astype(np.uint8)
    radius = max(1, round(SETTINGS['feature_guard_scene_pixels'] * scale))
    owned = cv2.dilate(owned, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2*radius+1, 2*radius+1))) > 0
    if jaw_support is not None:
        support = np.asarray(jaw_support)
        if support.shape != alpha.shape or support.dtype != np.bool_:
            raise ValueError('Invalid speaking-jaw support.')
        owned |= support
    distance = cv2.distanceTransform(np.uint8(alpha > .05), cv2.DIST_L2, 5)
    width = max(2., SETTINGS['feather_scene_pixels'] * scale)
    ramp = _smooth(distance / width)
    tapered = np.minimum(alpha, ramp)
    permission = alpha*(1-strength) + tapered*strength
    permission[owned] = alpha[owned]
    weight = (1-_smooth(distance/(2*width)))*strength
    weight[owned | (alpha == 0)] = 0
    # Low frequencies only; a small working grid avoids another expensive
    # full-resolution Gaussian per frame. This never copies source actor RGB.
    working = SETTINGS['working_size']
    small_raw = cv2.resize(raw.astype(np.float32), (working, working), interpolation=cv2.INTER_AREA)
    small_edit = cv2.resize(edited, (working, working), interpolation=cv2.INTER_AREA)
    sigma = max(.5, 2*scale/8)
    bias = cv2.GaussianBlur(small_raw-small_edit, (0, 0), sigma)
    limit = SETTINGS['maximum_lighting_bias']
    bias = cv2.resize(bias, (512, 512), interpolation=cv2.INTER_LINEAR).clip(-limit, limit)
    result = (edited + bias*weight[..., None]).clip(0, 255)
    result[owned | (alpha == 0)] = edited[owned | (alpha == 0)]
    return result, permission, {'version': SETTINGS['version'],
                                 'boundaryPixels': int(((weight > 0) & (alpha > 0)).sum()),
                                 'strength': strength, 'outwardGrowth': False,
                                 'sourceRGBTransferred': False}


def composite(frame, raw, edited, matrix, alpha, skin, labels, jaw_support=None, strength=SETTINGS['strength']):
    if strength == 0:
        from face_feature_cleanup import absolute_composite
        result, permission = absolute_composite(frame, raw, edited, matrix, alpha, skin)
        return result, permission, {'version': SETTINGS['version'], 'boundaryPixels': 0,
                                   'strength': 0, 'outwardGrowth': False, 'sourceRGBTransferred': False}
    frame = np.asarray(frame)
    if frame.ndim != 3 or frame.shape[2] != 3 or frame.dtype != np.uint8:
        raise ValueError('Expected a uint8 BGR scene.')
    matrix = np.asarray(matrix, np.float64)
    if matrix.shape != (2, 3) or not np.isfinite(matrix).all() or abs(np.linalg.det(matrix[:, :2])) < 1e-8:
        raise ValueError('Invalid boundary projection matrix.')
    scale = float(np.hypot(matrix[0, 0], matrix[1, 0]))
    corrected = match_lighting(raw, edited, skin, scale)
    corrected, alpha, detail = boundary_plane(raw, corrected, alpha, labels, scale, jaw_support, strength)
    inverse = cv2.invertAffineTransform(matrix)
    geometry = (frame.shape[1], frame.shape[0])
    permission = cv2.warpAffine(alpha, inverse, geometry).clip(0, 1)
    permission *= cv2.warpAffine(np.float32(alpha > 0), inverse, geometry, flags=cv2.INTER_NEAREST)
    projected = cv2.warpAffine(corrected, inverse, geometry)
    result = np.rint(projected*permission[..., None] + frame*(1-permission[..., None])).clip(0, 255).astype(np.uint8)
    if not np.array_equal(result[permission == 0], frame[permission == 0]):
        raise ValueError('Boundary blending changed protected scene pixels.')
    return result, permission, detail


def cleanup_frame(models, parser, frame, crop, driver, matrix, source_landmarks,
                  occlusion, source_occlusion, regional):
    raw_labels, source_labels = parser(crop), parser(driver)
    corrected = models.correct(driver, crop, np.ones((512, 512), np.float32), regional)
    labels = parser(corrected)
    scale = float(np.hypot(matrix[0, 0], matrix[1, 0]))
    alpha, skin, jaw = jaw_masks(raw_labels, labels, occlusion, source_labels, source_occlusion, source_landmarks, scale)
    gates = source_eye_gates(source_labels, source_landmarks)
    corrected, detail = restore_eye_detail(crop, corrected, labels, occlusion, gates)
    # Keep the established new-chin support intact when the jaw rule granted it.
    support = (raw_labels == 14) & (labels == 1) & (alpha > 0) if jaw['supportPixels'] else None
    result, permission, boundary = composite(frame, crop, corrected, matrix, alpha, skin, labels, support)
    return result, {'sourceEyeGates': gates, **detail, 'editablePixels': int((permission > 0).sum()),
                    'jawGeometry': jaw, 'boundaryBlend': boundary}
