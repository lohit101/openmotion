"""Source-driven expression transfer and fixed-donor ONNX identity correction.

PerformRecast geometry follows the official Replacement route and the attributed
VisoMaster regional composition. Identity pixel boost follows pinned FaceFusion.
This module never downloads weights or starts compute.
"""
from pathlib import Path

import cv2
import numpy as np


def compose_expression(target, driver, regional):
    """Preserve target canonical anatomy/pose; source supplies expression."""
    exp = target.reshape(1, 49, 3)
    driving = driver.reshape(1, 49, 3)
    cheeks, jaw = [31, 32, 33, 36, 37, 38], [44, 45, 46]
    if not regional:
        desired = driving.copy()
        desired[:, cheeks, 2] = exp[:, cheeks, 2]
        desired[:, jaw, 2] = exp[:, jaw, 2]
        desired[:, jaw, 0] = exp[:, jaw, 0]
        desired[:, jaw, 1] = .2 * exp[:, jaw, 1] + .8 * driving[:, jaw, 1]
        desired[:, cheeks, :2] = .3 * exp[:, cheeks, :2] + .7 * driving[:, cheeks, :2]
        return desired
    mouths = list(range(8))
    eyes = [27, 28, 29, 30, 34, 35, 47, 48]
    brows = [15, 16, 17, 18, 19, 21, 22, 23, 24, 25]
    structural = sorted(set(range(49)) - set(mouths + eyes + brows + cheeks + jaw))
    offset = exp[:, structural].mean(axis=1, keepdims=True) - driving[:, structural].mean(axis=1, keepdims=True)
    weights = np.zeros((1, 49, 3), np.float32)
    for points, weight in [(mouths, 1.), (eyes, .8), (brows, .9), (cheeks, .2), (jaw, .15)]:
        weights[:, points, :2] = weight
    return exp + (driving + offset - exp) * weights


def pose_rotation(motion):
    angles = []
    for key in ['pitch', 'yaw', 'roll']:
        logits = motion[key]
        probabilities = np.exp(logits - logits.max(axis=1, keepdims=True))
        probabilities /= probabilities.sum(axis=1, keepdims=True)
        angles.append(float((probabilities * np.arange(66)).sum() * 3 - 99) * (3.14 / 180))
    pitch, yaw, roll = angles
    cp, sp, cy, sy, cr, sr = np.cos(pitch), np.sin(pitch), np.cos(yaw), np.sin(yaw), np.cos(roll), np.sin(roll)
    return (np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]]) @
            np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]) @
            np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])).astype(np.float32)


def tensor_image(frame, size):
    frame = cv2.resize(frame, (size, size), interpolation=cv2.INTER_AREA)
    return np.ascontiguousarray(frame[:, :, ::-1].transpose(2, 0, 1)[None], dtype=np.float32) / 255


def face_permission(frame, box):
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = [float(value) for value in box]
    w, h = x2 - x1, y2 - y1
    mask = np.zeros((height, width), np.float32)
    cv2.ellipse(mask, (round((x1+x2)/2), round(y1+.51*h)), (max(1, round(.58*w)), max(1, round(.58*h))), 0, 0, 360, 1., -1)
    mask = cv2.GaussianBlur(mask, (0, 0), max(1., w*.025))
    allowed = np.zeros_like(mask)
    left, right = max(0, int(np.floor(x1-.1*w))), min(width, int(np.ceil(x2+.1*w)))
    top, bottom = max(0, int(np.floor(y1-.06*h))), min(height, int(np.ceil(y2+.08*h)))
    allowed[top:bottom, left:right] = mask[top:bottom, left:right]
    return allowed


def composite_face(frame, crop, affine, mask):
    inverse = cv2.invertAffineTransform(affine)
    geometry = (frame.shape[1], frame.shape[0])
    projected = cv2.warpAffine(crop, inverse, geometry, flags=cv2.INTER_LINEAR)
    alpha = cv2.warpAffine(mask, inverse, geometry, flags=cv2.INTER_LINEAR).clip(0, 1)
    result = np.rint(projected * alpha[..., None] + frame * (1-alpha[..., None])).clip(0, 255).astype(np.uint8)
    if np.any(result[alpha == 0] != frame[alpha == 0]):
        raise ValueError('Facial processing changed protected scene pixels.')
    return result


class FaceModels:
    def __init__(self, root, reference_embedding):
        import torch
        import onnxruntime as ort
        ort.preload_dlls()
        if not torch.cuda.is_available() or 'CUDAExecutionProvider' not in ort.get_available_providers():
            raise ValueError('CUDA facial processing is unavailable; no CPU fallback was started.')
        self.ort = ort
        self.sessions = {}
        self.gpu = torch.cuda.get_device_name(0)
        self.embedding = np.asarray(reference_embedding, np.float32).reshape(1, 512)
        if not np.isfinite(self.embedding).all() or not np.isclose(np.linalg.norm(self.embedding), 1, atol=1e-4):
            raise ValueError('Invalid fixed reference-face embedding.')
        for name, relative in [('appearance', 'performrecast/appearance_feature_extractor.onnx'), ('motion', 'performrecast/motion_extractor.onnx'),
                               ('warp', 'performrecast/warping_module.onnx'), ('decode', 'performrecast/spade_generator.onnx'),
                               ('identity', 'facefusion/hyperswap_1a_256.onnx')]:
            options = ort.SessionOptions()
            options.intra_op_num_threads = 4
            options.inter_op_num_threads = 1
            options.log_severity_level = 3
            session = ort.InferenceSession(str(Path(root)/relative), sess_options=options,
                                          providers=['CUDAExecutionProvider', 'CPUExecutionProvider'])
            if session.get_providers()[0] != 'CUDAExecutionProvider':
                raise ValueError('A face model failed to initialize CUDA: ' + name)
            session.disable_fallback()
            self.sessions[name] = session

    def infer(self, name, inputs, gpu=False):
        session = self.sessions[name]
        binding = session.io_binding()
        for key, value in inputs.items():
            if isinstance(value, self.ort.OrtValue):
                binding.bind_ortvalue_input(key, value)
            else:
                binding.bind_cpu_input(key, np.ascontiguousarray(value, dtype=np.float32))
        for output in session.get_outputs():
            binding.bind_output(output.name, 'cuda', 0)
        session.run_with_iobinding(binding)
        values = binding.get_outputs()
        return {output.name: value if gpu else value.numpy() for output, value in zip(session.get_outputs(), values)}

    def expression(self, driver, target, regional):
        source_motion = self.infer('motion', {'image': tensor_image(driver, 256)})
        target_motion = self.infer('motion', {'image': tensor_image(target, 256)})
        kp, exp = [target_motion[key].reshape(1, 49, 3) for key in ['kp', 'exp']]
        desired = compose_expression(exp, source_motion['exp'], regional)
        rotation = pose_rotation(target_motion)
        scale = target_motion['scale'][:, None, :]
        translation = target_motion['t'].copy()[:, None, :]
        translation[:, :, 2] = 0
        original = ((kp + exp) @ rotation.T) * scale + translation
        driven = ((kp + desired) @ rotation.T) * scale + translation
        feature = self.infer('appearance', {'source_image': tensor_image(target, 512)}, True)['feature_3d']
        warped = self.infer('warp', {'feature_3d': feature, 'kp_driving': driven, 'kp_source': original}, True)['out']
        output = self.infer('decode', {'feature': warped})['out']
        if not np.isfinite(output).all():
            raise ValueError('Facial expression model returned invalid pixels.')
        return np.clip(output[0].transpose(1, 2, 0) * 255, 0, 255).astype(np.uint8)[:, :, ::-1]

    def identity(self, target, permission):
        tiles = target.reshape(256, 2, 256, 2, 3).transpose(1, 3, 0, 2, 4).reshape(4, 256, 256, 3)
        results = []
        for tile in tiles:
            output = self.infer('identity', {'source': self.embedding, 'target': tensor_image(tile, 256)*2-1})['output'][0]
            if not np.isfinite(output).all():
                raise ValueError('ONNX identity model returned invalid pixels.')
            rgb = (output.transpose(1, 2, 0)*.5+.5).clip(0, 1)
            results.append(rgb[:, :, ::-1]*255)
        swapped = np.stack(results).reshape(2, 2, 256, 256, 3).transpose(2, 0, 3, 1, 4).reshape(512, 512, 3)
        return np.rint(swapped*permission[..., None] + target*(1-permission[..., None])).clip(0, 255).astype(np.uint8)

    def correct(self, driver, target, permission, regional):
        expression = self.expression(driver, target, regional)
        identity = self.identity(expression, permission)
        return np.rint(.6*identity + .4*expression).clip(0, 255).astype(np.uint8)
