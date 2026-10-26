#!/usr/bin/env python3
"""CPU preparation and pixel-preserving finalization for Klein image edits.

No model weights are downloaded here. Face detection reuses the existing local
YuNet setup; it is not face recognition or proof of identity fidelity.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
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


def padded(image, max_pixels):
    cv2, _ = dependencies()
    h, w = image.shape[:2]
    scale = min(1, math.sqrt(max_pixels / (w * h)))
    cw, ch = max(1, round(w * scale)), max(1, round(h * scale))
    width, height = max(64, math.ceil(cw / 16) * 16), max(64, math.ceil(ch / 16) * 16)
    x, y = (width - cw) // 2, (height - ch) // 2
    scaled = cv2.resize(image, (cw, ch), interpolation=cv2.INTER_AREA) if (cw, ch) != (w, h) else image
    return cv2.copyMakeBorder(scaled, y, height - ch - y, x, width - cw - x, cv2.BORDER_REPLICATE)


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


def fingerprint(request):
    keys = ["source", "reference", "face", "mask"]
    files = {key: sha256(request[key]) if request.get(key) else None for key in keys}
    payload = {"files": files, "settings": request["settings"], "geometry": request["geometry"]}
    if request.get("version"):
        payload["version"] = request["version"]
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
        return {"hasFace": previous["hasFace"], "warnings": previous["warnings"]}
    source, reference = read_image(request["source"]), read_image(request["reference"])
    g, s = request["geometry"], request["settings"]
    if (source.shape[1], source.shape[0]) != (g["outputWidth"], g["outputHeight"]):
        raise ValueError("The target's decoded orientation differs from its saved dimensions. Export an upright PNG and upload it again.")
    small = cv2.resize(source, (g["contentWidth"], g["contentHeight"]), interpolation=cv2.INTER_AREA)
    target = cv2.copyMakeBorder(small, g["y"], g["height"] - g["contentHeight"] - g["y"], g["x"], g["width"] - g["contentWidth"] - g["x"], cv2.BORDER_REPLICATE)
    atomic_png(folder / "target.png", target)
    atomic_png(folder / "original.png", source)
    atomic_png(folder / "identity.png", padded(reference, 1_000_000))
    outputs = ["target.png", "original.png", "identity.png"]
    warnings, has_face = [], False
    if s["faceDetail"]:
        if request.get("face"):
            crop = read_image(request["face"])
        else:
            faces = detect(reference, model)
            crop = face_crop(reference, faces[0]) if len(faces) == 1 else None
            if crop is None:
                warnings.append("No unambiguous face close-up could be extracted. The full identity reference is used; add a clear close-up for stronger facial guidance.")
        if crop is not None:
            atomic_png(folder / "face.png", padded(crop, 384 * 384))
            outputs.append("face.png")
            has_face = True
    if s["protectBackground"]:
        if not request.get("mask"):
            raise ValueError("Paint the replacement area before using background protection.")
        mask = read_image(request["mask"], gray=True)
        if abs((mask.shape[1] / mask.shape[0]) / (source.shape[1] / source.shape[0]) - 1) > .02:
            raise ValueError("The edit mask belongs to a different target image. Paint the area again.")
        mask = cv2.resize(mask, (source.shape[1], source.shape[0]), interpolation=cv2.INTER_LINEAR)
        if not np.any(mask > 8):
            raise ValueError("The edit mask is empty. Paint over the person you want to replace.")
        # Feather inward only: a zero mask pixel never admits generated pixels.
        if s["feather"]:
            mask = np.minimum(mask, cv2.GaussianBlur(mask, (0, 0), max(.1, s["feather"] / 2)))
        atomic_png(folder / "edit-mask.png", mask)
        outputs.append("edit-mask.png")
        if request.get("version") == "masked-latent-v2":
            small_mask = cv2.resize(mask, (g["contentWidth"], g["contentHeight"]), interpolation=cv2.INTER_AREA)
            working_mask = cv2.copyMakeBorder(small_mask, g["y"], g["height"] - g["contentHeight"] - g["y"], g["x"], g["width"] - g["contentWidth"] - g["x"], cv2.BORDER_CONSTANT, value=0)
            atomic_png(folder / "working-mask.png", working_mask)
            outputs.append("working-mask.png")
        if np.mean(mask > 0) > .98:
            warnings.append("The edit area covers almost the entire photo. Background protection applies only outside the painted area.")
    atomic_json(marker, {"fingerprint": signature, "hasFace": has_face, "warnings": warnings, "outputs": {name: sha256(folder / name) for name in outputs}})
    return {"hasFace": has_face, "warnings": warnings}


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
    if protected:
        mask = read_image(folder / "edit-mask.png", gray=True)
        outside = mask == 0
        # Undo any PNG float quantization outside the mask, preserving exact
        # decoded source pixels without applying the feather a second time.
        output[outside] = source[outside]
        outside_difference = int(np.max(np.abs(output[outside].astype(np.int16) - source[outside].astype(np.int16)))) if np.any(outside) else 0
    atomic_png(folder / "final.png", output)
    faces = {}
    for name, image in [("source", source), ("reference", read_image(request["reference"])), ("output", output)]:
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
