"""Target-aware facial feature ownership; separate from frozen v1/v2 recipes.

The source video controls performance, not the replacement's hair matte. A
single absolute feature plane prevents displaced eyes/brows from surviving as
an additive residual. This module never downloads models or starts compute.
"""
import cv2
import numpy as np

FACE_CLASSES = (1, 2, 3, 4, 5, 10, 11, 12, 13)
FEATURE_CLASSES = (2, 3, 4, 5, 11, 12, 13)


class SemanticParser:
    """Explicit installed parser, using CUDA without an execution fallback."""
    def __init__(self, model_root):
        from pathlib import Path
        import onnxruntime as ort
        if 'CUDAExecutionProvider' not in ort.get_available_providers():
            raise ValueError('CUDA facial cleanup is unavailable; no CPU fallback was started.')
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(str(Path(model_root) / 'facefusion/bisenet_resnet_34.onnx'),
            sess_options=options, providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
        if self.session.get_providers()[0] != 'CUDAExecutionProvider':
            raise ValueError('The facial region parser did not initialize CUDA.')
        self.session.disable_fallback()

    def __call__(self, image):
        image = _image(image)
        tensor = image[:, :, ::-1].astype(np.float32) / 255
        tensor = (tensor - np.array([.485, .456, .406], np.float32)) / np.array([.229, .224, .225], np.float32)
        tensor = np.ascontiguousarray(tensor.transpose(2, 0, 1)[None])
        value = self.session.run(None, {self.session.get_inputs()[0].name: tensor})[0]
        if value.shape != (1, 19, 512, 512) or not np.isfinite(value).all():
            raise ValueError('The facial region parser returned invalid output.')
        return value[0].argmax(0).astype(np.uint8)


def smooth(value):
    value = np.clip(value, 0, 1)
    return value * value * (3 - 2 * value)


def _dilate(mask, radius):
    radius = max(1, round(radius))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))
    return cv2.dilate(mask.astype(np.uint8), kernel).astype(np.float32)


def _labels(value):
    value = np.asarray(value)
    if value.shape != (512, 512) or not np.issubdtype(value.dtype, np.integer) or np.any((value < 0) | (value > 18)):
        raise ValueError('Expected a finite 512-pixel facial region map.')
    return value


def _alpha(value):
    value = np.asarray(value, np.float32)
    if value.shape != (512, 512) or not np.isfinite(value).all() or np.any((value < 0) | (value > 1)):
        raise ValueError('Expected a finite facial permission map in the range 0–1.')
    return value


def feature_masks(raw_labels, edited_labels, occlusion, scale):
    """Own complete features while retaining the actual output's occluders.

    Only a feature actually visible in the raw face may override an XSeg hole.
    Never grow that witness into hair, glasses, background or other occluders.
    The edited face cannot grant itself permission over those protected areas.
    """
    raw_labels, edited_labels = _labels(raw_labels), _labels(edited_labels)
    occlusion = _alpha(occlusion)
    if not np.isfinite(scale) or not .05 <= scale <= 32:
        raise ValueError('Invalid facial projection scale.')
    raw_features = np.isin(raw_labels, FEATURE_CLASSES)
    edited_features = np.isin(edited_labels, FEATURE_CLASSES)
    raw_face = np.isin(raw_labels, FACE_CLASSES)
    distance = cv2.distanceTransform(raw_face.astype(np.uint8), cv2.DIST_L2, 5)
    allowed = np.maximum(occlusion, raw_features.astype(np.float32)) * raw_face
    alpha = smooth(distance / max(2, 6 * scale)) * allowed
    core = _dilate(raw_features | edited_features, max(2, 3 * scale))
    core = cv2.GaussianBlur(core, (0, 0), max(.5, scale))
    alpha = np.maximum(alpha, core * allowed).clip(0, 1)
    skin = (raw_labels == 1) & (edited_labels == 1)
    skin &= _dilate(raw_features | edited_features, max(2, 8 * scale)) == 0
    skin &= alpha > .95
    return alpha.astype(np.float32), skin.astype(np.float32)


def match_lighting(raw, edited, skin, scale):
    """Bounded low-frequency correction; no feature sharpening or whitening."""
    raw, edited = _image(raw), _image(edited)
    skin = _alpha(skin)
    if skin.sum() < 50:
        return edited.astype(np.float32)
    sigma = max(10, 30 * scale)
    weight = cv2.GaussianBlur(skin, (0, 0), sigma)
    delta = np.clip(raw.astype(np.float32) - edited, -25, 25) * skin[..., None]
    bias = cv2.GaussianBlur(delta, (0, 0), sigma) / np.maximum(weight[..., None], .001)
    return np.clip(edited + .65 * np.clip(bias, -12, 12), 0, 255)


def _image(value):
    value = np.asarray(value)
    if value.shape != (512, 512, 3) or value.dtype != np.uint8:
        raise ValueError('Expected a 512-pixel uint8 BGR facial crop.')
    return value


def absolute_composite(frame, raw, edited, matrix, alpha, skin):
    """Replace one feature plane, preserving exact pixels outside permission."""
    frame = np.asarray(frame)
    if frame.ndim != 3 or frame.shape[2] != 3 or frame.dtype != np.uint8:
        raise ValueError('Expected a uint8 BGR scene.')
    matrix = np.asarray(matrix, np.float64)
    if matrix.shape != (2, 3) or not np.isfinite(matrix).all() or abs(np.linalg.det(matrix[:, :2])) < 1e-8:
        raise ValueError('Invalid facial projection matrix.')
    scale = float(np.hypot(matrix[0, 0], matrix[1, 0]))
    if not .05 <= scale <= 32:
        raise ValueError('Invalid facial projection scale.')
    alpha, skin = _alpha(alpha), _alpha(skin)
    corrected = match_lighting(raw, edited, skin, scale)
    inverse = cv2.invertAffineTransform(matrix)
    geometry = (frame.shape[1], frame.shape[0])
    permission = cv2.warpAffine(alpha, inverse, geometry).clip(0, 1)
    # Interpolation must not leak a sliver of editing permission across a
    # classified occluder boundary when the face transform is subpixel.
    hard_support = cv2.warpAffine((alpha > 0).astype(np.float32), inverse, geometry, flags=cv2.INTER_NEAREST)
    permission *= hard_support
    projected = cv2.warpAffine(corrected, inverse, geometry)
    result = np.rint(projected * permission[..., None] + frame * (1 - permission[..., None])).clip(0, 255).astype(np.uint8)
    if not np.array_equal(result[permission == 0], frame[permission == 0]):
        raise ValueError('Facial cleanup changed protected scene pixels.')
    return result, permission


def eye_areas(labels):
    """Use image halves: parser left/right class names are not reliable here."""
    eyes = np.isin(_labels(labels), (4, 5))
    return np.array([eyes[:, :256].sum(), eyes[:, 256:].sum()], np.float32)


def source_eye_gates(labels, landmarks):
    """Require both visible eye area and source landmark opening for texture.

    Area is normalized to each eye's width, not an assumed frame-zero pose.
    This leaves later-reference jobs and closed-eye openings well-defined.
    These are texture-permission gates, not gaze or identity confidence scores.
    """
    labels = _labels(labels)
    points = np.asarray(landmarks, np.float32)
    if points.shape != (68, 2) or not np.isfinite(points).all():
        raise ValueError('Invalid aligned source eye landmarks.')
    groups = sorted((points[36:42], points[42:48]), key=lambda p: float(p[:, 0].mean()))
    areas = eye_areas(labels)
    gates = []
    for area, p in zip(areas, groups):
        width = float(np.linalg.norm(p[0] - p[3]))
        if width < 1:
            raise ValueError('Degenerate source eye geometry.')
        opening = float((np.linalg.norm(p[1] - p[5]) + np.linalg.norm(p[2] - p[4])) / (2 * width))
        gates.append(float(min(smooth((area / width ** 2 - .025) / .1), smooth((opening - .09) / .1))))
    return gates


def restore_eye_detail(raw, edited, labels, occlusion, open_gates):
    """Register native iris texture only within confidently open edited eyes.

    Forward/backward flow rejects unreliable correspondence. A closed source
    eye must receive no texture, irrespective of what the raw animation shows.
    This restores existing animation pixels; it cannot invent a correct gaze.
    """
    raw, edited = _image(raw), _image(edited)
    labels, occlusion = _labels(labels), _alpha(occlusion)
    gates = np.asarray(open_gates, np.float32)
    if gates.shape != (2,) or not np.isfinite(gates).all() or np.any((gates < 0) | (gates > 1)):
        raise ValueError('Invalid source eye-opening gates.')
    distance = cv2.distanceTransform(np.isin(labels, (4, 5)).astype(np.uint8), cv2.DIST_L2, 5)
    alpha = smooth(distance / 3)
    alpha[:, :256] *= gates[0]
    alpha[:, 256:] *= gates[1]
    alpha = np.minimum(alpha, occlusion)
    if not np.any(alpha):
        return edited.copy(), {'eyeTexturePixels': 0, 'meanFlowConfidence': None}
    new_gray = cv2.GaussianBlur(cv2.cvtColor(edited, cv2.COLOR_BGR2GRAY), (0, 0), 1)
    raw_gray = cv2.GaussianBlur(cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY), (0, 0), 1)
    flow_engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    forward = flow_engine.calc(new_gray, raw_gray, None)
    backward = flow_engine.calc(raw_gray, new_gray, None)
    yy, xx = np.mgrid[:512, :512].astype(np.float32)
    map_x, map_y = xx + forward[:, :, 0], yy + forward[:, :, 1]
    registered = cv2.remap(raw.astype(np.float32), map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    reverse = cv2.remap(backward, map_x, map_y, cv2.INTER_LINEAR)
    error = np.linalg.norm(forward + reverse, axis=2)
    confidence = np.exp(-(error / 1.5) ** 2).astype(np.float32)
    weight = (alpha * confidence * .65)[..., None]
    result = np.rint(registered * weight + edited * (1 - weight)).clip(0, 255).astype(np.uint8)
    if not np.array_equal(result[alpha == 0], edited[alpha == 0]):
        raise ValueError('Eye texture changed pixels outside the permitted eye interiors.')
    return result, {'eyeTexturePixels': int(np.any(result != edited, axis=2).sum()),
                    'meanFlowConfidence': float(confidence[alpha > 0].mean())}


def cleanup_frame(models, parser, frame, crop, driver, matrix, source_landmarks, occlusion, regional):
    """Keep the accepted expression route and own the corrected features once."""
    raw_labels, source_labels = parser(crop), parser(driver)
    # Identity is blended with the expression once, before final scene masking.
    # Legacy correct() and its v1/v2 callers retain their original permissions.
    corrected = models.correct(driver, crop, np.ones((512, 512), np.float32), regional)
    labels = parser(corrected)
    scale = float(np.hypot(matrix[0, 0], matrix[1, 0]))
    alpha, skin = feature_masks(raw_labels, labels, occlusion, scale)
    gates = source_eye_gates(source_labels, source_landmarks)
    corrected, detail = restore_eye_detail(crop, corrected, labels, occlusion, gates)
    result, permission = absolute_composite(frame, crop, corrected, matrix, alpha, skin)
    return result, {'sourceEyeGates': gates, **detail, 'editablePixels': int((permission > 0).sum())}
