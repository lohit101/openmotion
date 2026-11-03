#!/usr/bin/env python3
"""Whole-image Imagen input preparation and lossless PNG finalization.

No inpainting boundary, face restoration, beauty filtering or model downloads.
"""
import argparse
import json
from pathlib import Path
from image_replacement import read_image
from reference_geometry import atomic_json, atomic_png, dependencies


def reference(file, view=None):
    cv2, np = dependencies()
    image = read_image(file)
    rgba = cv2.imread(str(file), cv2.IMREAD_UNCHANGED)
    if rgba is not None and rgba.ndim == 3 and rgba.shape[2] == 4:
        values = rgba.astype(np.float32) / (257 if rgba.dtype == np.uint16 else 1)
        alpha = values[:, :, 3:4] / 255
        image = np.rint(values[:, :, :3] * alpha + 255 * (1 - alpha)).clip(0, 255).astype(np.uint8)
    if view:
        x, y, w, h = (int(view[key]) for key in ('x', 'y', 'width', 'height'))
        if x < 0 or y < 0 or min(w, h) < 1 or x + w > image.shape[1] or y + h > image.shape[0]:
            raise ValueError('The selected reference view is outside its image.')
        image = image[y:y + h, x:x + w]
    h, w = image.shape[:2]
    scale = min(1, 1024 / max(w, h))
    width, height = max(1, round(w * scale)), max(1, round(h * scale))
    if (width, height) != (w, h):
        image = cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)
    # Native Qwen keeps reference sizes at a 32-pixel grid.
    return cv2.copyMakeBorder(image, 0, (-height) % 32, 0, (-width) % 32, cv2.BORDER_REFLECT_101)


def prepare(request, folder):
    cv2, np = dependencies()
    g, settings = request['geometry'], request['settings']
    folder.mkdir(parents=True, exist_ok=True)
    if settings['workflow'] != 'text-to-image':
        source = read_image(request['source'])
        scaled = cv2.resize(source, (g['contentWidth'], g['contentHeight']), interpolation=cv2.INTER_LANCZOS4 if g['contentWidth'] > source.shape[1] else cv2.INTER_AREA)
        target = cv2.copyMakeBorder(scaled, g['y'], g['height'] - g['contentHeight'] - g['y'], g['x'], g['width'] - g['contentWidth'] - g['x'], cv2.BORDER_REFLECT_101)
        atomic_png(folder / 'target.png', target)
        atomic_png(folder / 'original.png', source)
        atomic_png(folder / 'identity.png', reference(request['reference'], settings.get('bodyReferenceView') if settings['workflow'] != 'clothing-only' else None))
        if request.get('face'):
            atomic_png(folder / 'face.png', reference(request['face'], settings.get('faceReferenceView')))
        if request.get('clothing'):
            atomic_png(folder / 'clothing.png', reference(request['clothing']))
    atomic_png(folder / 'edit-mask.png', np.full((g['outputHeight'], g['outputWidth']), 255, dtype=np.uint8))
    atomic_json(folder / 'imagen-permission.json', {'version': 'imagen-v1', 'editable': 'whole-image', 'manualMask': False, 'geometry': g})
    return {'hasFace': bool(request.get('face')), 'warnings': []}


def finish(request, folder):
    image = read_image(folder / 'gpu-result.png')
    g = request['geometry']
    if image.shape[:2] != (g['outputHeight'], g['outputWidth']):
        raise ValueError('The saved image dimensions differ from this frozen Imagen request. The paid output is retained.')
    # Preserve the model's native pixels. Never smooth/repaint a face in finishing.
    atomic_png(folder / 'final.png', image)
    review = {'status': 'review', 'warnings': [], 'backgroundProtected': False, 'outsideMaskMaxDifference': None,
              'sourceFace': False, 'referenceFace': False, 'outputFace': False}
    atomic_json(folder / 'image-review.json', review)
    return review


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'finish'])
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--folder', type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text())
    if request.get('version') != 'imagen-v1':
        raise ValueError('Unknown Imagen preparation version.')
    print(json.dumps((prepare if args.action == 'prepare' else finish)(request, args.folder)), flush=True)


if __name__ == '__main__':
    main()
