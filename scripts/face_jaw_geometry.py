"""Keep a speaking chin inside the final face plane, with visible-neck support.

This is independent of clip identity, filenames, duration and timestamps. The
source jaw must be visible. Only connected generated skin over the raw visible
neck may extend permission; hair, clothes and background never grant support.
The old v1–v5 mask and expression models remain unchanged.
"""
import json
from pathlib import Path

import cv2
import numpy as np

from face_feature_cleanup import FACE_CLASSES, _alpha, _labels, feature_masks


def settings():
    return json.loads((Path(__file__).resolve().parents[1] / 'config/facial-consistency-geometry.lock.json').read_text())


def jaw_masks(raw_labels, edited_labels, occlusion, source_labels,
              source_occlusion, source_points, scale):
    """Expand one unified matte, rather than layering two feathered jawlines."""
    raw_labels, edited_labels = _labels(raw_labels), _labels(edited_labels)
    source_labels = _labels(source_labels)
    occlusion, source_occlusion = _alpha(occlusion), _alpha(source_occlusion)
    alpha, skin = feature_masks(raw_labels, edited_labels, occlusion, scale)
    points = np.asarray(source_points, np.float32)
    if points.shape != (68, 2) or not np.isfinite(points).all():
        raise ValueError('Invalid source jaw landmarks.')
    config = settings()
    detail = {'version': config['version'], 'sourceJawVisibility': 0.,
              'extensionPixels': 0, 'bridgePixels': 0, 'supportPixels': 0,
              'reason': 'source-jaw-not-visible'}
    polygon = np.vstack([points[4:13], points[54], points[57], points[48]])
    if np.any(polygon < 1) or np.any(polygon > 510):
        detail['reason'] = 'source-jaw-outside-crop'
        return alpha, skin, detail
    witness = np.zeros((512, 512), np.uint8)
    cv2.fillPoly(witness, [np.rint(polygon).astype(np.int32)], 1)
    visible = np.isin(source_labels, FACE_CLASSES) & (source_occlusion > .5)
    area = int(witness.sum())
    coverage = float(visible[witness > 0].mean()) if area else 0.
    detail['sourceJawVisibility'] = coverage
    if area < config['minimum_source_jaw_area_crop_pixels'] or coverage < config['source_jaw_minimum_visible_fraction']:
        return alpha, skin, detail
    mouths = np.isin(raw_labels, (11, 12, 13)) | np.isin(edited_labels, (11, 12, 13))
    yy, _ = np.where(mouths)
    face = np.isin(raw_labels, FACE_CLASSES)
    fy, _ = np.where(face)
    if not len(yy) or not len(fy):
        detail['reason'] = 'jaw-geometry-uncertain'
        return alpha, skin, detail
    lower_limit = int(yy.mean())
    extension = ((raw_labels == config['new_chin_destination_class']) &
                 (edited_labels == config['new_chin_generated_class']))
    extension[:lower_limit] = False
    outside = cv2.distanceTransform((~face).astype(np.uint8), cv2.DIST_L2, 5)
    extension &= outside <= config['maximum_outward_jaw_fraction_of_face_height'] * (fy.max() - fy.min() + 1)
    adjacent = cv2.dilate(face.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    count, labels = cv2.connectedComponents(extension.astype(np.uint8))
    keep = [i for i in range(1, count) if np.any((labels == i) & adjacent)]
    extension = np.isin(labels, keep)
    if not extension.any():
        detail['reason'] = 'no-outward-jaw-motion'
        return alpha, skin, detail
    radius = max(1, round(config['outer_jaw_feather_source_pixels'] * scale))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    support = cv2.dilate(extension.astype(np.uint8), kernel) > 0
    support &= np.isin(raw_labels, config['editable_destination_classes'])
    support[:lower_limit] = False
    virtual_labels = raw_labels.copy()
    virtual_labels[support] = 1
    allowed = occlusion.copy()
    allowed[support] = 1
    expanded, _ = feature_masks(virtual_labels, edited_labels, allowed, scale)
    detail.update(extensionPixels=int(extension.sum()), bridgePixels=int((support & face).sum()),
                  supportPixels=int(support.sum()), reason=None)
    # Keep lighting statistics from the old face interior; never use newly
    # claimed neck pixels to decide the replacement's skin colour.
    return expanded, skin, detail


def cleanup_frame(models, parser, frame, crop, driver, matrix, source_landmarks,
                  occlusion, source_occlusion, regional):
    from face_feature_cleanup import absolute_composite, restore_eye_detail, source_eye_gates
    raw_labels, source_labels = parser(crop), parser(driver)
    corrected = models.correct(driver, crop, np.ones((512, 512), np.float32), regional)
    labels = parser(corrected)
    scale = float(np.hypot(matrix[0, 0], matrix[1, 0]))
    alpha, skin, jaw = jaw_masks(raw_labels, labels, occlusion, source_labels,
                                source_occlusion, source_landmarks, scale)
    gates = source_eye_gates(source_labels, source_landmarks)
    corrected, detail = restore_eye_detail(crop, corrected, labels, occlusion, gates)
    result, permission = absolute_composite(frame, crop, corrected, matrix, alpha, skin)
    return result, {'sourceEyeGates': gates, **detail,
                    'editablePixels': int((permission > 0).sum()), 'jawGeometry': jaw}
