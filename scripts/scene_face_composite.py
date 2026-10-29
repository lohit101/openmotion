"""Immutable scene-residual-v1 compositor for new source-face-v2 jobs.

Keep legacy FaceModels and composite_face math unchanged. Work in output-pixel
units and add only an inward-feathered edit residual to the original scene.
"""
import cv2
import numpy as np


def composite_scene_face(frame, crop, corrected, affine, permission):
    if (frame.ndim != 3 or frame.shape[2] != 3 or crop.shape != corrected.shape or
            crop.ndim != 3 or crop.shape[2] != 3 or permission.shape != crop.shape[:2] or
            np.shape(affine) != (2, 3) or
            not all(np.isfinite(x).all() for x in (frame, crop, corrected, affine, permission))):
        raise ValueError('Invalid scene-face compositing inputs; source pixels were retained.')
    if abs(np.linalg.det(affine[:, :2])) < 1e-9:
        raise ValueError('Degenerate scene-face transform; source pixels were retained.')
    if not np.any(permission > 0):
        return frame.copy()
    geometry = (frame.shape[1], frame.shape[0])
    inverse = cv2.invertAffineTransform(affine)
    scale = float(np.hypot(affine[0, 0], affine[1, 0]))
    f, c = corrected.astype(np.float32), crop.astype(np.float32)
    broad = max(2, 9 * scale)
    correction = np.clip(cv2.GaussianBlur(c, (0, 0), broad) - cv2.GaussianBlur(f, (0, 0), broad), -12, 12)
    f += .65 * correction
    high = f - cv2.GaussianBlur(f, (0, 0), max(.5, .65 * scale))
    high *= np.minimum(1, np.max(np.abs(high), axis=2, keepdims=True) / 2)
    f += .65 * np.clip(high, -12, 12)
    permission = permission.clip(0, 1)
    distance = cv2.distanceTransform((permission > .05).astype(np.uint8), cv2.DIST_L2, 5)
    t = np.clip(distance / max(2, 3 * scale), 0, 1)
    alpha = np.minimum(permission, t * t * (3 - 2 * t))
    delta = cv2.warpAffine(f - c, inverse, geometry)
    mask = cv2.warpAffine(alpha, inverse, geometry).clip(0, 1)
    result = np.rint(frame + delta * mask[:, :, None]).clip(0, 255).astype(np.uint8)
    if not np.array_equal(result[mask == 0], frame[mask == 0]):
        raise ValueError('Scene-face compositing changed protected pixels.')
    return result
