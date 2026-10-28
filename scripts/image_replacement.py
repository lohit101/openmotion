#!/usr/bin/env python3
"""CPU preparation and pixel-preserving finalization for image edits.

No model weights are downloaded here. Face detection reuses the existing local
YuNet setup; it is not face recognition or proof of identity fidelity.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

from reference_geometry import YuNetDetector, atomic_json, atomic_png, confident_faces, dependencies, sha256


def read_image(file, gray=False):
    cv2, _ = dependencies()
    image = cv2.imread(str(file), cv2.IMREAD_GRAYSCALE if gray else cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("An image could not be decoded. Upload a PNG, JPEG or WebP again.")
    if image.shape[0] * image.shape[1] > 32_000_000:
        raise ValueError("Use input images of at most 32 megapixels.")
    return image


def padded(image, max_pixels, grid=16):
    cv2, _ = dependencies()
    h, w = image.shape[:2]
    scale = min(1, math.sqrt(max_pixels / (w * h)))
    cw, ch = max(1, round(w * scale)), max(1, round(h * scale))
    width, height = max(64, math.ceil(cw / grid) * grid), max(64, math.ceil(ch / grid) * grid)
    x, y = (width - cw) // 2, (height - ch) // 2
    scaled = cv2.resize(image, (cw, ch), interpolation=cv2.INTER_AREA) if (cw, ch) != (w, h) else image
    return cv2.copyMakeBorder(scaled, y, height - ch - y, x, width - cw - x, cv2.BORDER_REPLICATE)


def reference_view(image, view):
    """Explicit user-selected pixels; never guess a face from a reference sheet."""
    if view is None:
        return image
    fields = [view.get(key) for key in ('x', 'y', 'width', 'height')]
    if any(type(value) is not int for value in fields):
        raise ValueError('The selected reference view needs whole-pixel coordinates.')
    x, y, width, height = fields
    if min(x, y) < 0 or min(width, height) < 32 or x + width > image.shape[1] or y + height > image.shape[0]:
        raise ValueError('The selected view extends outside its reference image.')
    return image[y:y + height, x:x + width].copy()


def detect(image, model):
    if not model or not Path(model).is_file():
        return []
    return confident_faces(YuNetDetector(model).detect(image))


def face_crop(image, face):
    h, w = image.shape[:2]
    x, y, fw, fh = face["bbox"]
    side = max(fw, fh) * 1.9
    cx, cy = x + fw / 2, y + fh / 2
    x0, y0 = max(0, int(cx - side / 2)), max(0, int(cy - side / 2))
    x1, y1 = min(w, math.ceil(cx + side / 2)), min(h, math.ceil(cy + side / 2))
    return image[y0:y1, x0:x1]


def reference_field_of_view(reference, source, model):
    """Crop a distant body reference for a close-up target without warping it.

    This removes irrelevant standing-body framing from portrait edits. It does
    not infer pose or invent details absent from the original reference.
    """
    source_faces, reference_faces = detect(source, model), detect(reference, model)
    if len(source_faces) != 1 or len(reference_faces) != 1:
        return reference, False
    a, b = source_faces[0]["bbox"], reference_faces[0]["bbox"]
    factor = math.sqrt((b[2] * b[3]) / (a[2] * a[3]))
    sh, sw = source.shape[:2]
    rh, rw = reference.shape[:2]
    width, height = round(sw * factor), round(sh * factor)
    if min(width, height) < 32 or width > rw or height > rh or width * height > rw * rh * .72:
        return reference, False
    x = round(b[0] + b[2] / 2 - (a[0] + a[2] / 2) * factor)
    y = round(b[1] + b[3] / 2 - (a[1] + a[3] / 2) * factor)
    x, y = max(0, min(rw - width, x)), max(0, min(rh - height, y))
    return reference[y:y + height, x:x + width], True


def repair_small_mask_gaps(mask):
    """Close tiny enclosed paint gaps; never expand the outer paint boundary."""
    cv2, np = dependencies()
    # Include antialiased fringes inside a gap; otherwise a partially painted
    # ring still leaks the original skin/clothing into the replacement.
    count, labels, stats, _ = cv2.connectedComponentsWithStats((mask < 254).astype(np.uint8), 8)
    repaired, closed = mask.copy(), 0
    limit = max(4, round(mask.size * .002))
    h, w = mask.shape
    for label in range(1, count):
        x, y, width, height, area = stats[label]
        if 0 < x and 0 < y and x + width < w and y + height < h and area <= limit:
            repaired[labels == label] = 255
            closed += 1
    return repaired, closed


def source_structure(source, geometry, model, layout_mask=None, identity_source=None):
    """Actual source contours, without encoding the original face's inner details."""
    cv2, np = dependencies()
    gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), .8), 60, 150)
    faces = detect(source, model)
    if identity_source is not None:
        if layout_mask is None or len(faces) != 1:
            raise ValueError('The identity placement guide needs a painted target with one visible face.')
        # V8 carries the already transferred identity at the captured scale.
        # Remove the original hair, jewelry and garment interior; preserve
        # body/shoulder contours instead of deriving them from the donor pose.
        x, y, fw, fh = faces[0]['bbox']
        inside = layout_mask > 8
        yy, xx = np.indices(inside.shape)
        edges[inside & (yy < y + fh * 1.1)] = 0
        edges[inside & (yy >= y + fh) & (xx > x + fw * .1) & (xx < x + fw * .9)] = 0
        anchor_gray = cv2.cvtColor(identity_source, cv2.COLOR_BGR2GRAY)
        anchor_edges = cv2.Canny(cv2.GaussianBlur(anchor_gray, (3, 3), .8), 20, 60)
        face_area = np.zeros_like(edges)
        cv2.ellipse(face_area, (round(x + fw / 2), round(y + fh / 2)),
                    (max(1, round(fw * .49)), max(1, round(fh * .49))), 0, 0, 360, 255, -1)
        use = inside & (face_area > 0)
        edges[use] = anchor_edges[use]
    elif layout_mask is not None:
        # V7 uses only the outer body placement, never clothing, jewelry,
        # source hair or internal facial edges. Keep the old guide unchanged
        # for every previously paid version.
        inside = layout_mask > 8
        distance = cv2.distanceTransform(inside.astype(np.uint8), cv2.DIST_L2, 5)
        band = max(4, round(source.shape[1] * .045))
        edges[inside & (distance > band)] = 0
        if len(faces) == 1:
            x, y, fw, fh = faces[0]['bbox']
            yy, _ = np.indices(inside.shape)
            edges[inside & (yy < y + fh * 1.15)] = 0
            cv2.ellipse(edges, (round(x + fw / 2), round(y + fh / 2)),
                        (max(1, round(fw / 2)), max(1, round(fh / 2))), 0, 0, 360, 255, 2)
    elif len(faces) == 1:
        x, y, fw, fh = faces[0]["bbox"]
        cv2.ellipse(edges, (round(x + fw / 2), round(y + fh / 2)), (max(1, round(fw * .38)), max(1, round(fh * .38))), 0, 0, 360, 0, -1)
    g = geometry
    small = cv2.resize(edges, (g["contentWidth"], g["contentHeight"]), interpolation=cv2.INTER_LINEAR)
    padded = cv2.copyMakeBorder(small, g["y"], g["height"] - g["contentHeight"] - g["y"], g["x"], g["width"] - g["contentWidth"] - g["x"], cv2.BORDER_CONSTANT, value=0)
    return cv2.cvtColor(padded, cv2.COLOR_GRAY2BGR)


def fingerprint(request):
    keys = ["source", "reference", "face", "mask"]
    files = {key: sha256(request[key]) if request.get(key) else None for key in keys}
    if request.get('scopeMask'):
        files['scopeMask'] = sha256(request['scopeMask'])
    if request.get('version') in ('body-only-v5', 'body-only-v6') and request.get('bodyBase'):
        digest = sha256(request['bodyBase'])
        if digest != request.get('bodyBaseSHA256'):
            raise ValueError('The saved body image changed. No face correction was submitted and no body will be regenerated.')
        files['bodyBase'] = digest
    payload = {"files": files, "settings": request["settings"], "geometry": request["geometry"]}
    if request.get("version"):
        payload["version"] = request["version"]
    if request["settings"].get("localIdentity", False):
        payload["localIdentityProfile"] = sha256(Path(__file__).resolve().parents[1] / 'config/local-identity.lock.json')
    if request['settings'].get('qwenBodyPose', False) or request.get('version') == 'body-only-v4' and request['settings'].get('bodyOnlyPose', False):
        payload['localPoseProfile'] = sha256(Path(__file__).resolve().parents[1] / 'config/local-pose.lock.json')
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def prepare(request, folder, model):
    cv2, np = dependencies()
    folder = Path(folder)
    marker = folder / "image-inputs.json"
    signature = fingerprint(request)
    if marker.exists():
        previous = json.loads(marker.read_text())
        if previous["fingerprint"] != signature or any(not (folder / name).is_file() or sha256(folder / name) != digest for name, digest in previous["outputs"].items()):
            raise ValueError("Saved image inputs changed or are incomplete. Reuse settings for a new job; this run will not silently change its conditioning.")
        return {"hasFace": previous["hasFace"], "warnings": previous["warnings"], **({'headEdit': previous['headEdit']} if 'headEdit' in previous else {})}
    source, reference = read_image(request["source"]), read_image(request["reference"])
    g, s = request["geometry"], request["settings"]
    if (source.shape[1], source.shape[0]) != (g["outputWidth"], g["outputHeight"]):
        raise ValueError("The target's decoded orientation differs from its saved dimensions. Export an upright PNG and upload it again.")
    local_identity = s.get('localIdentity', False)
    conditioning = source
    if local_identity:
        run_local_identity(request['reference'], request['source'], folder / 'identity-anchored-target.png', request.get('mask'))
        conditioning = read_image(folder / 'identity-anchored-target.png')
    small = cv2.resize(conditioning, (g["contentWidth"], g["contentHeight"]), interpolation=cv2.INTER_AREA)
    target = cv2.copyMakeBorder(small, g["y"], g["height"] - g["contentHeight"] - g["y"], g["x"], g["width"] - g["contentWidth"] - g["x"], cv2.BORDER_REPLICATE)
    atomic_png(folder / "target.png", target)
    atomic_png(folder / "original.png", source)
    qwen = s.get("model") == "qwen21"
    scene = qwen and request.get("version") in ("scene-anchor-v1", "scene-anchor-v2", "scene-anchor-v3", "scene-anchor-v4", "scene-anchor-v5", "scene-anchor-v6", "scene-anchor-v7", "scene-anchor-v8")
    body_identity = request.get('version') in ('body-identity-v1', 'body-identity-v2')
    body_only = request.get('version') in ('body-only-v1', 'body-only-v2', 'body-only-v3', 'body-only-v4', 'body-only-v5', 'body-only-v6', 'body-only-single-v1')
    staged_body_only = request.get('version') in ('body-only-v3', 'body-only-v4')
    native_mask = body_identity or body_only or request.get("version") in ("native-mask-v1", "native-scene-v1", "identity-first-v1", "identity-first-v2", "scene-anchor-v4", "scene-anchor-v5", "scene-anchor-v6", "scene-anchor-v7", "scene-anchor-v8")
    head_refine = (scene or native_mask) and s.get("qwenHeadRefine", False)
    reference_input, cropped = reference_field_of_view(reference, source, model) if request.get("version") == "masked-latent-v4" and not qwen else (reference, False)
    if request.get('version') in ('body-only-v2', 'body-only-v3', 'body-only-v4', 'body-only-v5', 'body-only-v6', 'body-only-single-v1'):
        reference_input = reference_view(reference_input, s.get('bodyReferenceView'))
    atomic_png(folder / "identity.png", padded(reference_input, 1_500_000 if body_only else 590_000 if qwen else 1_000_000, 32 if qwen else 16))
    outputs = ["target.png", "original.png", "identity.png"]
    if body_only and request.get('version') != 'body-only-single-v1':
        if not request.get('face'):
            raise ValueError('Body-only replacement requires its facial identity reference or sheet.')
        facial_reference = read_image(request['face'])
        if request.get('version') in ('body-only-v2', 'body-only-v3', 'body-only-v4', 'body-only-v5', 'body-only-v6', 'body-only-single-v1'):
            facial_reference = reference_view(facial_reference, s.get('faceReferenceView'))
        atomic_png(folder / 'face.png', padded(facial_reference, 1_500_000, 32))
        outputs.append('face.png')
        if staged_body_only:
            height, width = reference_input.shape[:2]
            side = max(height, width)
            square = np.full((side, side, 3), 255, np.uint8)
            top, left = (side - height) // 2, (side - width) // 2
            square[top:top + height, left:left + width] = reference_input
            atomic_png(folder / 'body-reference-canvas.png', square)
            outputs.append('body-reference-canvas.png')
    if request.get('version') == 'body-identity-v2' or request.get('version') == 'body-only-v4' and s.get('bodyOnlyPose', False):
        root = Path(__file__).resolve().parents[1]
        pose_request = folder / 'pose-request.json'
        atomic_json(pose_request, request)
        result = subprocess.run([str(root / '.local/facefusion-venv/bin/python'), str(root / 'scripts/local_pose.py'), 'run', '--request', str(pose_request), '--folder', str(folder)], capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise ValueError(result.stderr.strip() or 'Local pose preparation failed. No GPU job was submitted.')
        outputs += ['source-pose.png', 'body-appearance.png', 'pose-preparation.json']
    if body_identity and s.get('qwenNormalizeReference', False):
        # Preserve visible anatomy while giving native Qwen a square output
        # canvas. Padding is explicit; never stretch the reference body.
        rh, rw = reference.shape[:2]
        scale = 1024 / max(rh, rw)
        cw, ch = round(rw * scale), round(rh * scale)
        square = np.full((1024, 1024, 3), 240, np.uint8)
        x, y = (1024 - cw) // 2, (1024 - ch) // 2
        square[y:y + ch, x:x + cw] = cv2.resize(reference, (cw, ch), interpolation=cv2.INTER_AREA)
        atomic_png(folder / 'body-reference-canvas.png', square)
        outputs.append('body-reference-canvas.png')
    if local_identity:
        outputs += ['identity-anchored-target.png', 'identity-anchored-target.identity.json']
    warnings, has_face = [], body_only and request.get('version') != 'body-only-single-v1'
    if cropped:
        warnings.append("The full-body identity reference was cropped to match the target's tighter field of view. The original reference is retained.")
    refine = (request.get("version") in ["masked-latent-v3", "masked-latent-v4"] and s.get("identityRefine", False)) or head_refine
    if s["faceDetail"] or refine:
        if request.get("face"):
            crop = read_image(request["face"])
        else:
            faces = detect(reference, model)
            crop = face_crop(reference, faces[0]) if len(faces) == 1 else None
            if crop is None:
                warnings.append("No unambiguous face close-up could be extracted. The full identity reference is used; add a clear close-up for stronger facial guidance.")
        if native_mask and crop is not None:
            # Identity refinement uses a tight crop from the original person,
            # removing unrelated reference arms and scenery rather than making
            # a new synthetic face reference.
            crop_input = read_image(request["face"]) if request.get("face") else reference
            crop_faces = detect(crop_input, model)
            if len(crop_faces) != 1:
                raise ValueError("The identity pass needs one clear reference face.")
            fx, fy, fw, fh = crop_faces[0]["bbox"]
            height, width = crop_input.shape[:2]
            crop = crop_input[max(0, int(fy - .16 * fh)):min(height, math.ceil(fy + 1.12 * fh)), max(0, int(fx - .15 * fw)):min(width, math.ceil(fx + 1.15 * fw))]
        if crop is not None:
            atomic_png(folder / "face.png", padded(crop, 590_000 if head_refine else 1_000_000 if refine and request.get("version") == "masked-latent-v4" else 384 * 384, 32 if head_refine else 16))
            outputs.append("face.png")
            has_face = True
    if refine and not has_face:
        raise ValueError("Identity refinement requires one clear reference face. Add a close-up before generating.")
    working_mask = None
    if s["protectBackground"]:
        if not request.get("mask"):
            raise ValueError("Paint the replacement area before using background protection.")
        mask = read_image(request["mask"], gray=True)
        if abs((mask.shape[1] / mask.shape[0]) / (source.shape[1] / source.shape[0]) - 1) > .02:
            raise ValueError("The edit mask belongs to a different target image. Paint the area again.")
        mask = cv2.resize(mask, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_LINEAR)
        if not np.any(mask > 8):
            raise ValueError("The edit mask is empty. Paint over the person you want to replace.")
        if scene and s.get("repairMaskGaps", False):
            mask, closed = repair_small_mask_gaps(mask)
            if closed:
                warnings.append("Closed %d tiny enclosed gaps in the painted mask. The outer paint boundary was retained; disable gap repair for deliberately protected small objects." % closed)
        # Native-mask v1 explicitly permits an outer margin. Keep historical
        # recipes and enclosed protection holes on their original behavior.
        if native_mask and (s.get("maskExpand", 0) or s.get("maskFillHoles", False)):
            expansion = int(s.get("maskExpand", 0))
            if not 0 <= expansion <= 64:
                raise ValueError("Edit allowance must be between 0 and 64 pixels.")
            background = (mask <= 8).astype(np.uint8)
            _, labels = cv2.connectedComponents(background, connectivity=8)
            border_labels = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
            protected_holes = (background > 0) & ~np.isin(labels, border_labels)
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * expansion + 1, 2 * expansion + 1))
            mask = cv2.dilate(mask, kernel)
            if not s.get("maskFillHoles", False):
                mask[protected_holes] = 0
            else:
                mask[protected_holes] = 255
            warnings.append("The replacement may extend %d pixels beyond the brush outline. %s" % (expansion, "Enclosed gaps may change." if s.get("maskFillHoles", False) else "Enclosed protected holes remain protected."))
        if request.get('scopeMask'):
            limit = read_image(request['scopeMask'], gray=True)
            if limit.shape != mask.shape:
                raise ValueError('The segment face scope does not match its exact saved frame. No repaint was submitted.')
            mask = np.minimum(mask, limit)
            warnings.append('Segment identity refresh edits only the recorded head area; existing body and scene pixels remain protected.')
        # The transition stays inside the effective permission region.
        if s["feather"]:
            mask = np.minimum(mask, cv2.GaussianBlur(mask, (0, 0), max(.1, s["feather"] / 2)))
        atomic_png(folder / "edit-mask.png", mask)
        outputs.append("edit-mask.png")
        if scene or body_identity or body_only or request.get("version") in ["masked-latent-v2", "masked-latent-v3", "masked-latent-v4", "native-mask-v1", "native-scene-v1", "identity-first-v1", "identity-first-v2"]:
            small_mask = cv2.resize(mask, (g["contentWidth"], g["contentHeight"]), interpolation=cv2.INTER_AREA)
            working_mask = cv2.copyMakeBorder(small_mask, g["y"], g["height"] - g["contentHeight"] - g["y"], g["x"], g["width"] - g["contentWidth"] - g["x"], cv2.BORDER_CONSTANT, value=0)
            atomic_png(folder / "working-mask.png", working_mask)
            outputs.append("working-mask.png")
        if np.mean(mask > 0) > .98:
            warnings.append("The edit area covers almost the entire photo. Background protection applies only outside the painted area.")
    if refine:
        faces = detect(source, model)
        if len(faces) != 1:
            raise ValueError("Identity refinement requires one clear face in the target. Choose a visible-face source frame before generating.")
        ref_faces = detect(read_image(folder / "face.png"), model)
        if len(ref_faces) != 1:
            raise ValueError("The identity close-up must show one clear face. Choose a sharper single-person reference.")
        x, y, fw, fh = faces[0]["bbox"]
        sx, sy = g["contentWidth"] / source.shape[1], g["contentHeight"] / source.shape[0]
        center = (round((x + fw / 2) * sx + g["x"]), round((y + fh / 2) * sy + g["y"]))
        axes = (max(1, round(fw * (.44 if body_identity else .58 if native_mask else .72) * sx)), max(1, round(fh * (.46 if body_identity else .65 if native_mask else .85) * sy)))
        face_mask = np.zeros((g["height"], g["width"]), dtype=np.uint8)
        cv2.ellipse(face_mask, center, axes, 0, 0, 360, 255, -1)
        face_mask = cv2.GaussianBlur(face_mask, (0, 0), max(2, min(axes) * .08))
        if working_mask is not None:
            face_mask = np.minimum(face_mask, working_mask)
        if not np.any(face_mask > 64):
            raise ValueError("Paint over the target face as well as the outfit before using identity refinement.")
        atomic_png(folder / "face-refine-mask.png", face_mask)
        outputs.append("face-refine-mask.png")
        if head_refine:
            # Keep a small face core unchanged in the outfit pass. The separate
            # head pass gets the actual source pose and expression as its base.
            core = np.zeros_like(face_mask)
            cv2.ellipse(core, center, (max(1, round(fw * .46 * sx)), max(1, round(fh * .46 * sy))), 0, 0, 360, 255, -1)
            core = cv2.GaussianBlur(core, (0, 0), max(1, min(axes) * .015))
            body = (working_mask.astype(np.float32) * (1 - core.astype(np.float32) / 255)).round().astype(np.uint8)
            # V1/V2 reinserting the original facial core caused the subsequent
            # head pass to retain that identity in our same-input GPU test.
            # V3 keeps the replacement already generated by the body adapter.
            if request.get("version") in ("scene-anchor-v3", "scene-anchor-v4", "scene-anchor-v5", "scene-anchor-v6", "scene-anchor-v7", "scene-anchor-v8"):
                body = working_mask.copy()
            atomic_png(folder / "body-mask.png", body)
            outputs.append("body-mask.png")
    if staged_body_only:
        faces = detect(source, model)
        reference_faces = detect(read_image(folder / 'face.png'), model)
        if len(faces) != 1 or len(reference_faces) != 1:
            raise ValueError('The staged photo evaluation needs one visible source face and one clear selected reference face. No GPU render was submitted.')
        x, y, fw, fh = faces[0]['bbox']
        sx, sy = g['contentWidth'] / source.shape[1], g['contentHeight'] / source.shape[0]
        face_mask = np.zeros((g['height'], g['width']), np.uint8)
        center = (round((x + fw / 2) * sx + g['x']), round((y + fh / 2) * sy + g['y']))
        axes = (max(1, round(fw * .60 * sx)), max(1, round(fh * .64 * sy)))
        cv2.ellipse(face_mask, center, axes, 0, 0, 360, 255, -1)
        face_mask = cv2.GaussianBlur(face_mask, (0, 0), max(2, min(axes) * .06))
        if working_mask is not None:
            face_mask = np.minimum(face_mask, working_mask)
        if not np.any(face_mask > 64):
            raise ValueError('Paint over the visible face before running the staged evaluation.')
        atomic_png(folder / 'face-refine-mask.png', face_mask)
        outputs.append('face-refine-mask.png')
    head_edit = None
    if request.get('version') in ('body-only-v5', 'body-only-v6'):
        base = read_image(request['bodyBase']) if request.get('bodyBase') else source
        if base.shape != source.shape:
            raise ValueError('The saved body and source dimensions differ. No photo was submitted.')
        head_edit, head_mask, head_reference = head_detail_inputs(source if request.get('version') == 'body-only-v6' else base, read_image(folder / 'face.png'), read_image(folder / 'edit-mask.png', gray=True), model)
        atomic_png(folder / 'head-detail-mask.png', head_mask)
        atomic_png(folder / 'head-detail-reference.png', head_reference)
        outputs += ['head-detail-mask.png', 'head-detail-reference.png']
        if request.get('bodyBase'):
            atomic_png(folder / 'body-base.png', base)
            outputs.append('body-base.png')
    if scene:
        if working_mask is None:
            raise ValueError("Source-anchored replacement requires a painted edit area.")
        guide_mask = read_image(request['mask'], gray=True) if request.get('version') in ('scene-anchor-v7', 'scene-anchor-v8') else None
        if guide_mask is not None:
            guide_mask = cv2.resize(guide_mask, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_LINEAR)
        identity_guide = conditioning if request.get('version') == 'scene-anchor-v8' and local_identity else None
        if request.get('version') == 'scene-anchor-v8' and identity_guide is None:
            raise ValueError('The identity placement guide requires local identity anchoring.')
        atomic_png(folder / "source-structure.png", source_structure(source, g, model, guide_mask, identity_guide))
        outputs.append("source-structure.png")
    details = {'headEdit': head_edit} if head_edit else {}
    atomic_json(marker, {"fingerprint": signature, "hasFace": has_face, "warnings": warnings, "outputs": {name: sha256(folder / name) for name in outputs}, **details})
    return {"hasFace": has_face, "warnings": warnings, **details}


def head_detail_inputs(base, reference, permission, model):
    """Edit the complete facial outline, keeping original pixel coordinates and protected holes."""
    cv2, np = dependencies()
    faces, refs = detect(base, model), detect(reference, model)
    if len(faces) != 1 or len(refs) != 1:
        raise ValueError('Head detail needs one visible face in the target and one selected reference face. Select a single sheet view before generating.')
    x, y, fw, fh = faces[0]['bbox']
    height, width = base.shape[:2]
    size = min(width, height, max(64, math.ceil(max(fw * 3, fh * 2.6))))
    left = max(0, min(width - size, round(x + fw / 2 - size / 2)))
    top = max(0, min(height - size, round(y + fh * .3 - size / 2)))
    mask = np.zeros((height, width), np.uint8)
    cv2.ellipse(mask, (round(x + fw / 2), round(y + fh * .35)),
                (max(1, round(fw)), max(1, round(fh))), 0, 0, 360, 255, -1)
    # Feather the outer head boundary, rather than averaging across the cheeks/jaw.
    mask = cv2.GaussianBlur(mask, (0, 0), max(1, fh * .015))
    # Keep the existing neck/accessories: a head adapter must not add the
    # reference's necklace below the jaw while preserving the transferred body.
    rows = np.arange(height, dtype=np.float32)[:, None]
    neck_gate = np.clip((y + fh * 1.16 - rows) / max(1, fh * .09), 0, 1)
    mask = np.rint(mask.astype(np.float32) * neck_gate).astype(np.uint8)
    crop_permission = np.zeros_like(mask); crop_permission[top:top + size, left:left + size] = 255
    mask = np.minimum(np.minimum(mask, permission), crop_permission)
    if not np.any(mask > 128):
        raise ValueError('Paint over the head before using head detail. Protected areas will not be overridden.')
    rx, ry, rw, rh = refs[0]['bbox']
    rhh, rww = reference.shape[:2]
    ref = reference[max(0, round(ry - rh * .15)):min(rhh, math.ceil(ry + rh * 1.04)),
                    max(0, round(rx - rw * .3)):min(rww, math.ceil(rx + rw * 1.3))]
    return {'x': left, 'y': top, 'size': size, 'resolution': 1024}, mask, padded(ref, 590_000, 32)


def run_local_identity(reference, target, output, mask=None):
    root = Path(__file__).resolve().parents[1]
    runtime = root / '.local/facefusion-venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    if not runtime.is_file():
        raise ValueError('Install the optional local identity runtime first: python3 scripts/local_identity.py setup. No GPU job was submitted.')
    arguments = [str(runtime), str(root / 'scripts/local_identity.py'), 'run', '--reference', str(reference), '--target', str(target), '--output', str(output)]
    if mask:
        arguments += ['--mask', str(mask)]
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise ValueError(result.stderr.strip() or 'Local identity processing failed. The paid base image is retained.')


def integrate_scene(source, generated, mask):
    """Transfer generated gradients with an exact protected-pixel boundary.

    NORMAL_CLONE uses the replacement's gradients. MIXED_CLONE could reinsert
    source facial features and is deliberately not used. Padding prevents the
    old garment color at the photo edges from setting the new outfit's tone.
    """
    cv2, np = dependencies()
    pad = 64
    raw = cv2.copyMakeBorder(generated, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    destination = raw.copy()
    destination[pad:pad + source.shape[0], pad:pad + source.shape[1]] = source
    area = (mask > 8).astype(np.uint8) * 255
    area = cv2.copyMakeBorder(area, pad, pad, pad, pad, cv2.BORDER_REFLECT)
    area[:2] = 0; area[-2:] = 0; area[:, :2] = 0; area[:, -2:] = 0
    if not np.any(area):
        return source.copy()
    x, y, width, height = cv2.boundingRect(area)
    integrated = cv2.seamlessClone(raw, destination, area, (x + width // 2, y + height // 2), cv2.NORMAL_CLONE)
    integrated = integrated[pad:pad + source.shape[0], pad:pad + source.shape[1]]
    integrated[mask == 0] = source[mask == 0]
    return integrated


def finish(request, folder, model):
    cv2, np = dependencies()
    folder = Path(folder)
    source = read_image(folder / "original.png")
    output = read_image(folder / "gpu-result.png")
    if source.shape != output.shape:
        raise ValueError("The GPU returned unexpected dimensions. The paid result is retained locally; no new generation was submitted.")
    warnings = list(json.loads((folder / "image-inputs.json").read_text())["warnings"])
    protected = request["settings"]["protectBackground"]
    outside_difference = None
    if protected and request["settings"].get("qwenSceneIntegration", False):
        candidates = ["composition-raw.png", "lighting-raw.png", "body-stage.png", "body-raw.png"]
        raw_file = next((folder / name for name in candidates if (folder / name).is_file()), None)
        if raw_file is not None:
            g = request["geometry"]
            raw = read_image(raw_file)
            if request['settings'].get('qwenHeadRefine') and raw_file.name not in ('composition-raw.png', 'lighting-raw.png'):
                # Keep the completed head when recovering a historical result
                # that predates the assembled raw-stage export.
                if not (folder / 'head-raw.png').is_file() or not (folder / 'face-refine-mask.png').is_file():
                    raise ValueError('The assembled head stage is unavailable. Disable scene integration to finish the saved image without regenerating.')
                head = read_image(folder / 'head-raw.png')
                alpha = read_image(folder / 'face-refine-mask.png', gray=True).astype(np.float32)[..., None] / 255
                raw = np.rint(head * alpha + raw * (1 - alpha)).clip(0, 255).astype(np.uint8)
            raw = raw[g["y"]:g["y"] + g["contentHeight"], g["x"]:g["x"] + g["contentWidth"]]
            raw = cv2.resize(raw, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_AREA)
            output = integrate_scene(source, raw, read_image(folder / "edit-mask.png", gray=True))
        else:
            warnings.append("The raw stage was unavailable for scene integration. The paid image was retained without submitting another render.")
    if request['settings'].get('localIdentity', False):
        atomic_png(folder / 'integrated-base.png', output)
        run_local_identity(request['reference'], folder / 'integrated-base.png', folder / 'identity-refined.png', folder / 'edit-mask.png' if protected else None)
        output = read_image(folder / 'identity-refined.png')
    if protected:
        mask = read_image(folder / "edit-mask.png", gray=True)
        outside = mask == 0
        # Undo any PNG float quantization outside the mask, preserving exact
        # decoded source pixels without applying the feather a second time.
        output[outside] = source[outside]
        outside_difference = int(np.max(np.abs(output[outside].astype(np.int16) - source[outside].astype(np.int16)))) if np.any(outside) else 0
    outside_head = None
    if request.get('version') in ('body-only-v5', 'body-only-v6'):
        body_file = folder / ('body-base.png' if request.get('bodyBase') else 'body-stage.png')
        if not body_file.is_file():
            raise ValueError('The saved body stage is required to validate head-only pixel preservation. The paid output is retained.')
        base = read_image(body_file)
        head_mask = read_image(folder / 'head-detail-mask.png', gray=True)
        protected_body = head_mask == 0
        outside_head = int(np.max(np.abs(output[protected_body].astype(np.int16) - base[protected_body].astype(np.int16)))) if np.any(protected_body) else 0
        if outside_head:
            raise ValueError('The head edit changed protected body pixels. The paid result and body stage are retained for local recovery; no new inference is needed.')
    atomic_png(folder / "final.png", output)
    faces = {}
    settings = request["settings"]
    face_used = (settings.get("model") != "qwen21" and (settings["faceDetail"] or settings.get("identityRefine", False))) or (request.get("version") in ("scene-anchor-v1", "scene-anchor-v2", "scene-anchor-v3", "scene-anchor-v4", "scene-anchor-v5", "scene-anchor-v6", "scene-anchor-v7", "scene-anchor-v8", "native-mask-v1", "native-scene-v1", "identity-first-v1", "identity-first-v2", "body-identity-v1", "body-identity-v2") and settings.get("qwenHeadRefine", False))
    reference_file = (str(folder / 'face.png') if request.get('version') in ('body-only-v2', 'body-only-v3', 'body-only-v4', 'body-only-v5', 'body-only-v6') else request.get("face") if face_used or request.get('version') == 'body-only-v1' else None) or request["reference"]
    if request.get('version') == 'body-only-single-v1':
        reference_file = str(folder / 'identity.png')
    if request.get("version") in ("native-mask-v1", "native-scene-v1", "identity-first-v1", "identity-first-v2", "scene-anchor-v4", "scene-anchor-v5", "scene-anchor-v6", "scene-anchor-v7", "scene-anchor-v8", "body-identity-v1", "body-identity-v2") and face_used:
        reference_file = str(folder / "face.png")
    for name, image in [("source", source), ("reference", read_image(reference_file)), ("output", output)]:
        found = detect(image, model)
        faces[name] = found[0] if len(found) == 1 else None
        if faces[name]:
            atomic_png(folder / (name + "-face.png"), face_crop(image, faces[name]))
    if faces["source"] and faces["output"]:
        a, b = faces["source"]["bbox"], faces["output"]["bbox"]
        ratio = math.sqrt(b[2] * b[3] / (a[2] * a[3]))
        distance = math.hypot(((b[0] + b[2] / 2) - (a[0] + a[2] / 2)) / source.shape[1], ((b[1] + b[3] / 2) - (a[1] + a[3] / 2)) / source.shape[0])
        if not .8 <= ratio <= 1.25 or distance > .045:
            warnings.append("Detected head size or position differs from the target. Compare the result before using it for video.")
    else:
        warnings.append("Head position and scale could not be checked unambiguously. Review the target and result side by side.")
    if not faces["reference"] or not faces["output"]:
        warnings.append("A face close-up could not be prepared for both images. Review facial identity in the full image.")
    review = {"status": "warning" if warnings else "review", "warnings": warnings, "backgroundProtected": protected, "outsideMaskMaxDifference": outside_difference,
              "sourceFace": bool(faces["source"]), "referenceFace": bool(faces["reference"]), "outputFace": bool(faces["output"])}
    if outside_head is not None:
        review['outsideHeadMaxDifference'] = outside_head
    atomic_json(folder / "image-review.json", review)
    return review


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "finish"])
    parser.add_argument("--request", required=True)
    parser.add_argument("--folder", required=True)
    parser.add_argument("--model")
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text())
    folder = Path(args.folder)
    folder.mkdir(parents=True, exist_ok=True)
    for key in ["source", "reference", "face", "mask"]:
        if request.get(key) and Path(request[key]).resolve().parent == folder.resolve():
            raise ValueError("Original inputs must be separate from the job output folder.")
    result = prepare(request, folder, args.model) if args.action == "prepare" else finish(request, folder, args.model)
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
