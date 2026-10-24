#!/usr/bin/env python3
"""Prepare a source-relative character reference and audit rendered head geometry.

All detection, affine preparation and checking run locally on the CPU. This is
face detection, not face recognition or a guarantee of generated identity.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import uuid


VERSION = "face-v1"
SCORE_THRESHOLD = 0.8
MAX_DETECTION_SIDE = 960
MIN_SCALE = 0.05
MAX_SCALE = 8.0


class GeometryError(ValueError):
    """An actionable preflight failure; do not silently use the old framing."""


def dependencies():
    try:
        import cv2
        import numpy as np
    except ImportError as error:
        raise GeometryError("Local reference-framing dependencies are missing. Run the local geometry setup before generating.") from error
    return cv2, np


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_face(face):
    try:
        box = [float(value) for value in face["bbox"]]
        confidence = float(face.get("confidence", face.get("score", 0)))
    except (KeyError, TypeError, ValueError) as error:
        raise GeometryError("The face detector returned invalid geometry.") from error
    if len(box) != 4 or not all(math.isfinite(value) for value in box + [confidence]):
        raise GeometryError("The face detector returned non-finite geometry.")
    if box[2] <= 0 or box[3] <= 0 or not 0 <= confidence <= 1:
        raise GeometryError("The face detector returned an invalid face box or confidence.")
    result = {"bbox": box, "confidence": confidence}
    if face.get("landmarks") is not None:
        try:
            points = [[float(x), float(y)] for x, y in face["landmarks"]]
        except (TypeError, ValueError) as error:
            raise GeometryError("The face detector returned invalid landmarks.") from error
        if len(points) != 5 or not all(math.isfinite(value) for point in points for value in point):
            raise GeometryError("The face detector returned invalid landmarks.")
        result["landmarks"] = points
    return result


def validate_face_on_canvas(face, width, height):
    result = validate_face(face)
    x, y, w, h = result["bbox"]
    visible_w = max(0, min(width, x + w) - max(0, x))
    visible_h = max(0, min(height, y + h) - max(0, y))
    if (not 0 <= x + w / 2 <= width or not 0 <= y + h / 2 <= height or
            visible_w * visible_h < 0.5 * w * h):
        raise GeometryError("The detected face is outside the image or heavily cropped. Choose a clearer face before generating.")
    return result


def confident_faces(faces):
    return [face for face in (validate_face(value) for value in faces) if face["confidence"] >= SCORE_THRESHOLD]


def single_face(faces, subject):
    selected = confident_faces(faces)
    if len(selected) > 1:
        raise GeometryError("More than one face was detected in the %s. Use a single-person input or crop the intended character before generating." % subject)
    if not selected:
        raise GeometryError("No clear face was detected in the %s. Choose an unobstructed face or a clip that begins with a visible face." % subject)
    return selected[0]


class YuNetDetector:
    def __init__(self, model):
        cv2, _ = dependencies()
        model = Path(model)
        if not model.is_file():
            raise GeometryError("The small local face detector is missing. Run the local geometry setup before generating.")
        try:
            self.detector = cv2.FaceDetectorYN.create(str(model), "", (320, 320), SCORE_THRESHOLD, 0.3, 5000)
        except cv2.error as error:
            raise GeometryError("The local face detector could not load. Re-run the local geometry setup.") from error

    def detect(self, image):
        cv2, _ = dependencies()
        height, width = image.shape[:2]
        ratio = min(1.0, MAX_DETECTION_SIDE / max(width, height))
        resized_width = max(1, round(width * ratio))
        resized_height = max(1, round(height * ratio))
        scaled = cv2.resize(image, (resized_width, resized_height), interpolation=cv2.INTER_AREA) if ratio < 1 else image
        self.detector.setInputSize((resized_width, resized_height))
        try:
            _, found = self.detector.detect(scaled)
        except cv2.error as error:
            raise GeometryError("Local face detection failed. Check the detector and local OpenCV installation.") from error
        if found is None:
            return []
        # Integer resize rounding can give slightly different X/Y ratios.
        sx, sy = width / resized_width, height / resized_height
        faces = []
        for row in found:
            values = [float(value) for value in row]
            faces.append(validate_face_on_canvas({
                "bbox": [values[0] * sx, values[1] * sy, values[2] * sx, values[3] * sy],
                "landmarks": [[values[i] * sx, values[i + 1] * sy] for i in range(4, 14, 2)],
                "confidence": values[14],
            }, width, height))
        return faces


def affine_for_faces(source_face, reference_face):
    source = validate_face(source_face)["bbox"]
    reference = validate_face(reference_face)["bbox"]
    scale = math.sqrt((source[2] * source[3]) / (reference[2] * reference[3]))
    if not math.isfinite(scale) or not MIN_SCALE <= scale <= MAX_SCALE:
        raise GeometryError("The detected face sizes require an implausible reference scale. Use a clearer reference and source face.")
    tx = source[0] + source[2] / 2 - scale * (reference[0] + reference[2] / 2)
    ty = source[1] + source[3] / 2 - scale * (reference[1] + reference[3] / 2)
    if not all(math.isfinite(value) for value in (tx, ty)):
        raise GeometryError("The detected face positions cannot be aligned.")
    return {"scale": scale, "translateX": tx, "translateY": ty}


def warp_reference(image, width, height, transform):
    cv2, np = dependencies()
    if min(width, height) <= 0:
        raise GeometryError("The source canvas dimensions are invalid.")
    values = [float(transform[key]) for key in ("scale", "translateX", "translateY")]
    if not all(math.isfinite(value) for value in values) or not MIN_SCALE <= values[0] <= MAX_SCALE:
        raise GeometryError("The reference transform is invalid.")
    matrix = np.array([[values[0], 0, values[1]], [0, values[0], values[2]]], dtype=np.float64)
    # One scale on both axes: no body stretching or perspective deformation.
    return cv2.warpAffine(image, matrix, (int(width), int(height)), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))


def first_anchor(frames, detector):
    """Select the earliest confident single face in the first eight frames."""
    for index, image in frames:
        faces = confident_faces(detector.detect(image))
        if len(faces) > 1:
            raise GeometryError("More than one face was detected near the beginning of the source video. Use a single-person clip before generating.")
        if faces:
            return index, image, faces[0]
    raise GeometryError("No clear face was detected in the first eight source frames. Move the clip start to a visible face before generating.")


def initial_frames(source):
    cv2, _ = dependencies()
    cap = cv2.VideoCapture(str(source))
    try:
        if not cap.isOpened():
            raise GeometryError("The prepared source video could not be read.")
        for index in range(8):
            ok, image = cap.read()
            if not ok:
                break
            yield index, image
    finally:
        cap.release()


def protect_paths(inputs, outputs):
    sources = {Path(value).resolve() for value in inputs}
    destinations = [Path(value).resolve() for value in outputs]
    if len(set(destinations)) != len(destinations) or any(value in sources for value in destinations):
        raise GeometryError("Prepared images and reports must use separate output paths; original inputs will not be overwritten.")


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def atomic_png(path, image):
    cv2, _ = dependencies()
    path = Path(path)
    if path.suffix.lower() != ".png":
        raise GeometryError("The prepared character image must be saved as PNG.")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name("." + path.stem + "." + uuid.uuid4().hex + ".png")
    try:
        if not cv2.imwrite(str(temporary), image):
            raise GeometryError("The prepared character image could not be saved.")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def prepare(source, reference, output, report_path, model, detector=None):
    source, reference, output, report_path = map(Path, (source, reference, output, report_path))
    protect_paths([source, reference, model], [output, report_path])
    if not source.is_file() or not reference.is_file():
        raise GeometryError("The prepared source and original character reference must exist.")
    cv2, _ = dependencies()
    detector = detector or YuNetDetector(model)
    reference_image = cv2.imread(str(reference), cv2.IMREAD_COLOR)
    if reference_image is None:
        raise GeometryError("The character reference could not be read.")
    reference_face = validate_face_on_canvas(single_face(detector.detect(reference_image), "character reference"), reference_image.shape[1], reference_image.shape[0])
    frame_index, frame, source_face = first_anchor(initial_frames(source), detector)
    height, width = frame.shape[:2]
    source_face = validate_face_on_canvas(source_face, width, height)
    transform = affine_for_faces(source_face, reference_face)
    prepared = warp_reference(reference_image, width, height, transform)
    warnings = []
    for title, face in (("Source", source_face), ("Reference", reference_face)):
        if face["bbox"][2] < 40:
            warnings.append("%s face is small; use a clearer/larger face for reliable identity detail." % title)
    atomic_png(output, prepared)
    report = {"status": "aligned", "version": VERSION, "width": width, "height": height,
              "anchorFrame": frame_index, **transform, "sourceFace": source_face, "refFace": reference_face,
              "sourceSha256": sha256(source), "referenceSha256": sha256(reference), "preparedSha256": sha256(output),
              "warnings": warnings}
    atomic_json(report_path, report)
    return report


def compare_faces(source_face, output_face, source_size, output_size):
    source = validate_face(source_face)["bbox"]
    output = validate_face(output_face)["bbox"]
    sw, sh = source_size
    ow, oh = output_size
    if min(sw, sh, ow, oh) <= 0 or not all(math.isfinite(v) for v in (sw, sh, ow, oh)):
        raise GeometryError("Invalid video dimensions for framing comparison.")
    scale = math.sqrt((output[2] * output[3] / (ow * oh)) / (source[2] * source[3] / (sw * sh)))
    dx = (output[0] + output[2] / 2) / ow - (source[0] + source[2] / 2) / sw
    dy = (output[1] + output[3] / 2) / oh - (source[1] + source[3] / 2) / sh
    displacement = math.hypot(dx * sw, dy * sh) / math.hypot(sw, sh)
    return {"headScale": scale, "centerOffsetX": dx, "centerOffsetY": dy, "centerOffsetDiagonal": displacement,
            "scaleMatched": 0.85 <= scale <= 1.15, "positionMatched": displacement <= 0.04}


def video_info(cap, title):
    cv2, _ = dependencies()
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not cap.isOpened() or not math.isfinite(fps) or fps <= 0 or min(count, width, height) <= 0:
        raise GeometryError("The %s video has no readable frame rate or frames." % title)
    return {"fps": fps, "frames": count, "width": width, "height": height}


def sample_times(source_info, output_info):
    duration = min((source_info["frames"] - 1) / source_info["fps"], (output_info["frames"] - 1) / output_info["fps"])
    count = min(5, source_info["frames"], output_info["frames"])
    if count < 3 or duration <= 0:
        raise GeometryError("At least three matching video frames are needed to check framing.")
    return [duration * index / (count - 1) for index in range(count)]


def check(source, output_video, report_path, model, detector=None):
    source, output_video, report_path = map(Path, (source, output_video, report_path))
    protect_paths([source, output_video, model], [report_path])
    cv2, _ = dependencies()
    detector = detector or YuNetDetector(model)
    source_cap, output_cap = cv2.VideoCapture(str(source)), cv2.VideoCapture(str(output_video))
    try:
        si, oi = video_info(source_cap, "prepared source"), video_info(output_cap, "output")
        samples, warnings, missing = [], [], False
        if abs(si["fps"] - oi["fps"]) > 0.01:
            warnings.append("Source and output frame rates differ; framing samples were aligned by time.")
        for time in sample_times(si, oi):
            sample = {"timeSeconds": time}
            faces = []
            for title, cap, info in (("source", source_cap, si), ("output", output_cap, oi)):
                frame_index = min(info["frames"] - 1, round(time * info["fps"]))
                sample[title + "Frame"] = frame_index
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = cap.read()
                found = confident_faces(detector.detect(frame)) if ok else []
                if len(found) != 1:
                    faces.append(None)
                    sample[title + "Face"] = None
                    sample["reason"] = "Cannot verify %s framing: expected one clear face, found %d." % (title, len(found))
                else:
                    faces.append(found[0])
                    sample[title + "Face"] = found[0]
            if any(face is None for face in faces):
                missing = True
                sample["status"] = "unverified"
                warnings.append("At %.2fs: %s" % (time, sample["reason"]))
            else:
                sample.update(compare_faces(faces[0], faces[1], (si["width"], si["height"]), (oi["width"], oi["height"])))
                sample["status"] = "matched" if sample["scaleMatched"] and sample["positionMatched"] else "warning"
                if not sample["scaleMatched"]:
                    warnings.append("At %.2fs, rendered head scale is %.2fx the source; expected 0.85–1.15x." % (time, sample["headScale"]))
                if not sample["positionMatched"]:
                    warnings.append("At %.2fs, rendered face position differs by %.1f%% of the frame diagonal; expected at most 4%%." % (time, 100 * sample["centerOffsetDiagonal"]))
            samples.append(sample)
        drift = any(sample["status"] == "warning" for sample in samples)
        status = "warning" if drift else "unverified" if missing else "warning" if warnings else "matched"
        report = {"status": status, "version": VERSION, "source": si, "output": oi,
                  "samples": samples, "warnings": warnings, "sourceSha256": sha256(source), "outputSha256": sha256(output_video)}
        atomic_json(report_path, report)
        return report
    finally:
        source_cap.release()
        output_cap.release()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    preparation = commands.add_parser("prepare", help="Align a character reference to source face size and position.")
    preparation.add_argument("--source", required=True, type=Path)
    preparation.add_argument("--reference", required=True, type=Path)
    preparation.add_argument("--output", required=True, type=Path)
    preparation.add_argument("--report", required=True, type=Path)
    preparation.add_argument("--model", required=True, type=Path)
    verification = commands.add_parser("check", help="Measure output head scale and placement against the source.")
    verification.add_argument("--source", required=True, type=Path)
    verification.add_argument("--output-video", required=True, type=Path)
    verification.add_argument("--report", required=True, type=Path)
    verification.add_argument("--model", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        result = prepare(args.source, args.reference, args.output, args.report, args.model) if args.command == "prepare" else check(args.source, args.output_video, args.report, args.model)
        print(json.dumps(result, allow_nan=False))
        return 0
    except (GeometryError, OSError, ValueError) as error:
        print("Reference framing: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
