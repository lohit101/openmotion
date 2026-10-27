#!/usr/bin/env python3
"""Explicit local framing of an accepted image; no generation or downloads.

Requires a reviewed person matte, source edit allowance and existing YuNet model.
This changes uniform scale/translation only. It cannot correct a different pose
or camera perspective. Newly exposed background is approximate CPU inpainting.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def frame(source_path, image_path, matte_path, allowance_path, folder, model, scale):
    import cv2
    import numpy as np
    from image_replacement import detect, face_crop
    started = time.monotonic()
    if not math.isfinite(scale) or not 1 <= scale <= 1.5:
        raise ValueError('Use a uniform enlargement between 1 and 1.5.')
    source, image = [cv2.imread(str(p)) for p in (source_path, image_path)]
    matte, allowance = [cv2.imread(str(p), cv2.IMREAD_GRAYSCALE) for p in (matte_path, allowance_path)]
    if source is None or image is None or matte is None or allowance is None:
        raise ValueError('All four local inputs must be readable.')
    if source.shape != image.shape or matte.shape != image.shape[:2] or allowance.shape != matte.shape:
        raise ValueError('Inputs must share the original source dimensions.')
    a, b = detect(source, model), detect(image, model)
    if len(a) != 1 or len(b) != 1:
        raise ValueError('Framing requires one unambiguous face in each image.')
    def center(face):
        x, y, w, h = face['bbox']
        return np.array([x + w / 2, y + h / 2])
    target, current = center(a[0]), center(b[0])
    matrix = np.float32([[scale, 0, target[0] - scale * current[0]],
                         [0, scale, target[1] - scale * current[1]]])
    h, w = matte.shape
    silhouette = np.uint8(matte > 127) * 255
    # Premultiplied RGB avoids a dark fringe during resampling. A reviewed
    # silhouette is required because automatic face parsers can miss arms/hair.
    alpha = cv2.GaussianBlur(silhouette.astype(np.float32) / 255, (0, 0), 1.2)
    warped_alpha = np.clip(cv2.warpAffine(alpha, matrix, (w, h)), 0, 1)
    warped_rgb = cv2.warpAffine(image.astype(np.float32) * alpha[..., None], matrix,
                                (w, h), flags=cv2.INTER_LANCZOS4)
    removed = cv2.dilate(silhouette, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
    plate = cv2.inpaint(image, removed, 7, cv2.INPAINT_TELEA)
    output = np.uint8(np.clip(np.rint(warped_rgb + plate.astype(np.float32) * (1 - warped_alpha[..., None])), 0, 255))
    permission = np.maximum(allowance, np.uint8(warped_alpha > 0) * 255)
    outside = permission == 0
    output[outside] = source[outside]
    found = detect(output, model)
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    if (folder / 'final.png').exists():
        raise ValueError('Choose a new folder; existing results are immutable.')
    for name, data in [('final.png', output), ('original.png', source), ('edit-mask.png', permission), ('actor-matte.png', silhouette)]:
        if not cv2.imwrite(str(folder / name), data):
            raise ValueError('Could not save ' + name)
    cv2.imwrite(str(folder / 'poster.jpg'), cv2.resize(output, (max(1, round(w * min(1, 480 / h))), min(h, 480))))
    for name, img, faces in [('source', source, a), ('output', output, found)]:
        if len(faces) == 1:
            cv2.imwrite(str(folder / (name + '-face.png')), face_crop(img, faces[0]))
    geometry = None
    if len(found) == 1:
        src, dst = a[0]['bbox'], found[0]['bbox']
        geometry = {'headSizeRatio': math.sqrt(dst[2] * dst[3] / (src[2] * src[3])),
                    'faceCenterOffsetPixels': (center(found[0]) - target).tolist()}
    warnings = ['Local framing preview. Newly exposed background is reconstructed; review edges and occlusions. Pose and perspective are unchanged.']
    review = {'status': 'warning', 'warnings': warnings, 'backgroundProtected': True,
              'outsideMaskMaxDifference': int(np.abs(output[outside].astype(np.int16) - source[outside].astype(np.int16)).max()) if outside.any() else 0,
              'sourceFace': True, 'referenceFace': False, 'outputFace': len(found) == 1}
    (folder / 'image-review.json').write_text(json.dumps(review, indent=2) + '\n')
    receipt = {'version': 'foreground-scale-v1', 'scale': scale, 'matrix': matrix.tolist(), 'width': w, 'height': h,
               'parentSHA256': digest(image_path), 'sourceSHA256': digest(source_path), 'resultSHA256': digest(folder / 'final.png'),
               'maskSHA256': digest(folder / 'edit-mask.png'), 'matteSHA256': digest(folder / 'actor-matte.png'),
               'elapsedSeconds': time.monotonic() - started, 'paidInference': False, 'geometry': geometry}
    (folder / 'framing.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['source', 'image', 'matte', 'allowance', 'folder', 'model']:
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--scale', type=float, required=True)
    args = parser.parse_args()
    print(json.dumps(frame(args.source, args.image, args.matte, args.allowance, args.folder, args.model, args.scale)))
