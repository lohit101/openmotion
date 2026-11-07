"""Hash-bound, full-image preparation/export for versioned Image Edit recipes.

No face restoration, masking, compositing, prompt rewriting or model inference.
The Comfy node performs its own native reference scaling; keep complete images.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path

from reference_geometry import atomic_png, dependencies


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic_json(path, value):
    temp = path.with_suffix(path.suffix + '.part')
    temp.write_text(json.dumps(value, ensure_ascii=False, sort_keys=True))
    os.replace(temp, path)


def process(action, request, folder):
    cv2, np = dependencies()
    folder = Path(folder)
    if request.get('version') not in ('image-edit-2511-v1', 'image-edit-qwen21-v1'):
        raise ValueError('Unsupported Image Edit recipe')
    refs = request['references']
    if not 1 <= len(refs) <= 3:
        raise ValueError('Expected one to three ordered references')
    width, height = (request['geometry'][key] for key in ('width', 'height'))
    if any(not isinstance(v, int) or v < 64 or v > 4096 or v % 32 for v in (width, height)):
        raise ValueError('Invalid native canvas')
    receipt_file = folder / 'image-edit-inputs.json'
    if action == 'prepare':
        prepared = []
        for index, ref in enumerate(refs, 1):
            source = Path(ref['path'])
            if source.stat().st_size != ref['size'] or sha(source) != ref['sha256']:
                raise ValueError(f'Image {index} changed since this run was queued')
            header = source.read_bytes()[:16]
            if not (header.startswith(b'\x89PNG\r\n\x1a\n') or header.startswith(b'\xff\xd8\xff') or header.startswith(b'RIFF') and header[8:12] == b'WEBP'):
                raise ValueError('Use PNG, JPEG or WebP references')
            # COLOR applies EXIF orientation. UNCHANGED supplies PNG/WebP alpha.
            photo = cv2.imread(str(source), cv2.IMREAD_COLOR)
            if photo is None or photo.shape[0] * photo.shape[1] > 32_000_000 or min(photo.shape[:2]) < 32:
                raise ValueError('Reference dimensions are unsupported')
            if (photo.shape[1], photo.shape[0]) != (ref['width'], ref['height']):
                raise ValueError('Reference dimensions changed')
            rgba = cv2.imread(str(source), cv2.IMREAD_UNCHANGED)
            if rgba is not None and rgba.ndim == 3 and rgba.shape[2] == 4:
                if rgba.shape[:2] != photo.shape[:2]:
                    raise ValueError('Rotate and save this transparent reference before editing')
                values = rgba.astype(np.float32) / (257 if rgba.dtype == np.uint16 else 1)
                alpha = values[:, :, 3:4] / 255
                photo = np.rint(values[:, :, :3] * alpha + 255 * (1 - alpha)).clip(0, 255).astype(np.uint8)
            output = folder / f'edit-reference-{index}.png'
            if request['version'] == 'image-edit-qwen21-v1' and index == 1:
                # Qwen 2.1 resolution=0 derives its sampling latent from Image 1.
                # Fit the complete target to the selected canvas before encoding;
                # an independent empty latent would reintroduce scale/zoom drift.
                # Aspect changes use white letterboxing, never a crop or stretch.
                old_height, old_width = photo.shape[:2]
                scale = min(width / old_width, height / old_height)
                fitted_width = min(width, max(1, round(old_width * scale)))
                fitted_height = min(height, max(1, round(old_height * scale)))
                resized = cv2.resize(photo, (fitted_width, fitted_height), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LANCZOS4)
                canvas = np.full((height, width, 3), 255, dtype=np.uint8)
                x, y = (width - fitted_width) // 2, (height - fitted_height) // 2
                canvas[y:y + fitted_height, x:x + fitted_width] = resized
                photo = canvas
            atomic_png(output, photo)
            prepared.append({'id': ref['id'], 'sourceSHA256': ref['sha256'], 'preparedSHA256': sha(output), 'file': output.name, 'width': photo.shape[1], 'height': photo.shape[0]})
        atomic_json(receipt_file, {'version': request['version'], 'references': prepared, 'geometry': request['geometry'], 'settings': request['settings']})
        return {'hasFace': False, 'warnings': []}
    receipt = json.loads(receipt_file.read_text())
    if receipt['version'] != request['version'] or receipt['settings'] != request['settings'] or receipt['geometry'] != request['geometry']:
        raise ValueError('The frozen Image Edit recipe changed; native result is preserved')
    if len(receipt['references']) != len(refs):
        raise ValueError('The reference count changed')
    for ref, prepared in zip(refs, receipt['references']):
        if ref['id'] != prepared['id'] or ref['sha256'] != prepared['sourceSHA256'] or sha(folder / prepared['file']) != prepared['preparedSHA256']:
            raise ValueError('The frozen reference order or prepared pixels changed')
    native = folder / 'gpu-result.png'
    photo = cv2.imread(str(native), cv2.IMREAD_COLOR)
    if photo is None or photo.shape[:2] != (height, width):
        raise ValueError(f'Expected native {width} x {height}. The result was kept without resizing.')
    if request['settings']['format'] == 'jpeg':
        params = [cv2.IMWRITE_JPEG_QUALITY, 95, cv2.IMWRITE_JPEG_SAMPLING_FACTOR, cv2.IMWRITE_JPEG_SAMPLING_FACTOR_444]
        ok, encoded = cv2.imencode('.jpg', photo, params)
        if not ok:
            raise ValueError('Could not encode JPEG; native PNG is preserved')
        (folder / 'final.jpg.part').write_bytes(encoded.tobytes())
        os.replace(folder / 'final.jpg.part', folder / 'final.jpg')
    elif request['settings']['format'] == 'png':
        # Preserve the native PNG exactly, including metadata and RGB pixels.
        (folder / 'final.png.part').write_bytes(native.read_bytes())
        os.replace(folder / 'final.png.part', folder / 'final.png')
    else:
        raise ValueError('Unsupported export format')
    atomic_json(folder / 'image-edit-result.json', {'version': request['version'], 'nativeSHA256': sha(native), 'width': width, 'height': height, 'format': request['settings']['format'], 'resized': False, 'composited': False})
    return {'status': 'review', 'warnings': [], 'backgroundProtected': False, 'outsideMaskMaxDifference': None, 'sourceFace': False, 'referenceFace': False, 'outputFace': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=('prepare', 'finish'))
    parser.add_argument('--request', required=True)
    parser.add_argument('--folder', required=True)
    args = parser.parse_args()
    print(json.dumps(process(args.action, json.loads(Path(args.request).read_text()), args.folder)))
