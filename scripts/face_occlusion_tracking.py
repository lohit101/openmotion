"""Managed, resumable source/raw hand banks and bounded partial-source tracking.

No downloads, server changes, generative inference or source-R/eye-calibration
changes. SAM is released before the caller loads its facial generation models.
Injected backends support array/fake-callback tests without loading any model.
"""
from pathlib import Path
from fractions import Fraction
import gc
import hashlib
import json
import sys
import uuid

import cv2
import numpy as np

from face_partial_source import (SETTINGS, POLICY_SHA256, choose_clear_anchor,
                                 freeze_alignment, tracked_arc5, foreground_veto)
from face_occlusion_vendor.crop import crop_image, _transform_pts

VERSION = 'source-occlusion-v1'
ROOT = Path(__file__).resolve().parents[1]
TRACKING = SETTINGS['tracking']


def _sha(file):
    file = Path(file)
    if file.is_symlink() or not file.is_file():
        raise ValueError('Tracking cache must be an owned regular file.')
    h = hashlib.sha256()
    with file.open('rb') as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(part)
    return h.hexdigest()


def _atomic(file, value):
    file = Path(file)
    if file.is_symlink():
        raise ValueError('Tracking cache cannot be a symbolic link.')
    temporary = file.with_name(file.name + '.tmp')
    if temporary.is_symlink():
        raise ValueError('Tracking temporary cache cannot be a symbolic link.')
    temporary.write_text(json.dumps(value, sort_keys=True, allow_nan=False) + '\n')
    temporary.replace(file)


def _cancel(callback):
    if callback() is True:
        raise InterruptedError('Hand/partial-face preparation cancelled; verified caches were kept.')


def _face_json(face):
    if face is None:
        return None
    box, five, points = [np.asarray(v, np.float32) for v in face]
    if box.shape != (4,) or five.shape != (5, 2) or points.shape != (68, 2) or not all(np.isfinite(v).all() for v in [box, five, points]):
        raise ValueError('Invalid detected face observation.')
    return {'box': box.tolist(), 'five': five.tolist(), 'landmark68': points.tolist()}


def _face_arrays(value):
    return None if value is None else tuple(np.asarray(value[k], np.float32) for k in ['box', 'five', 'landmark68'])


def _holes(mask):
    mask = np.asarray(mask, bool).copy()
    count, labels, stats, _ = cv2.connectedComponentsWithStats((~mask).astype(np.uint8), 8)
    border = np.unique(np.r_[labels[0], labels[-1], labels[:, 0], labels[:, -1]])
    for label in range(1, count):
        if label not in border and stats[label, cv2.CC_STAT_AREA] <= TRACKING['enclosed_hole_pixels']:
            mask[labels == label] = True
    return mask


def _intersection(a, b):
    return max(0., min(a[2], b[2]) - max(a[0], b[0])) * max(0., min(a[3], b[3]) - max(a[1], b[1]))


def _clear_anchor(row, mask_record, bank_root):
    """Geometric seed visibility, never neutral-expression certification."""
    if row['face'] is None or row['ambiguous']:
        return False
    if mask_record['state'] == 'known-none':
        return True
    if mask_record['state'] != 'segmented':
        return False
    mask = cv2.imread(str(bank_root / mask_record['file']), 0)
    if mask is None:
        return False
    blocked = cv2.dilate((mask > 0).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    points = np.asarray(row['face']['landmark68'], np.float32)
    for group in [points[36:42], points[42:48], points[48:68]]:
        if (not np.isfinite(group).all() or np.any(group < 0) or
                np.any(group[:, 0] >= mask.shape[1]) or np.any(group[:, 1] >= mask.shape[0])):
            return False
        region = np.zeros(mask.shape, np.uint8)
        polygon = np.rint(cv2.convexHull(group)).astype(np.int32)
        cv2.fillConvexPoly(region, polygon, 1)
        region = cv2.dilate(region, np.ones((3, 3), np.uint8)) > 0
        if not region.any() or np.any(blocked & region):
            return False
    return True


def hand_tracks(observations):
    """Associate overlapping adjacent-frame boxes; IDs only organize mask union.

    This does not track people or establish hand identity. New/later hands get
    new seeds. Crossing/duplicate objects are harmless to an occlusion union;
    exceeding the resource bound marks the chunk unavailable instead of growing
    an unbounded SAM object bank.
    """
    tracks = []
    previous = []
    for i, observation in enumerate(observations):
        current, assigned = [], set()
        for hand in observation['hands']:
            choices = [(float(_intersection(hand['box'], tracks[t]['last']['box'])), t)
                       for t in previous if t not in assigned]
            overlap, selected = max(choices, default=(0., -1))
            if overlap <= 0:
                selected = len(tracks)
                tracks.append({'seedFrame': i, 'seed': hand, 'last': hand})
            else:
                tracks[selected]['last'] = hand
                if hand['score'] > tracks[selected]['seed']['score']:
                    tracks[selected].update(seedFrame=i, seed=hand)
            assigned.add(selected)
            current.append(selected)
        previous = current
    return tracks


class ModelBackend:
    """Existing pinned weights only. Construction never prepares/downloads."""
    def __init__(self, model_root=None):
        if model_root is None:
            from facial_runtime import MODEL_ROOT
            model_root = MODEL_ROOT
        self.root = Path(model_root) / 'occlusion'
        manifest = json.loads((ROOT / 'config/facial-consistency-occlusion-models.lock.json').read_text())
        self.models = {}
        for key, filename in [('landmark203', 'landmark203.onnx'), ('palm', 'palm_detection_mediapipe_2023feb.onnx'),
                              ('hand', 'handpose_estimation_mediapipe_2023feb.onnx'), ('sam2', 'sam2.1_hiera_tiny.pt')]:
            item = next(x for x in manifest['files'] if Path(x['destination']).name == filename)
            file = self.root / filename
            if file.stat().st_size != item['size'] or _sha(file) != item['sha256']:
                raise ValueError('Tracking weight differs from its pinned manifest: ' + filename)
            provider = ['OpenCV DNN CPU'] if key in ['palm', 'hand'] else ['Torch CUDA FP32'] if key == 'sam2' else ['CUDAExecutionProvider']
            self.models[key] = {'sha256': item['sha256'], 'size': item['size'], 'providers': provider,
                                'used': False, 'providerVerified': False}
        from face_occlusion_vendor.mp_palmdet import MPPalmDet
        from face_occlusion_vendor.mp_handpose import MPHandPose
        if cv2.dnn.DNN_TARGET_CPU not in cv2.dnn.getAvailableTargets(cv2.dnn.DNN_BACKEND_OPENCV):
            raise ValueError('Pinned OpenCV CPU hand backend is unavailable.')
        self.palm = MPPalmDet(str(self.root / 'palm_detection_mediapipe_2023feb.onnx'), scoreThreshold=TRACKING['palm_score'],
                             backendId=cv2.dnn.DNN_BACKEND_OPENCV, targetId=cv2.dnn.DNN_TARGET_CPU)
        self.hand = MPHandPose(str(self.root / 'handpose_estimation_mediapipe_2023feb.onnx'), confThreshold=TRACKING['hand_score'],
                               backendId=cv2.dnn.DNN_BACKEND_OPENCV, targetId=cv2.dnn.DNN_TARGET_CPU)
        for key in ['palm', 'hand']:
            self.models[key]['providerVerified'] = True
        self.landmark_session = None
        self.predictor = None

    def observe_face(self, image, face_fn):
        found = face_fn(image)
        if isinstance(found, dict):
            # Enriched callbacks may explicitly distinguish uncertain/multiple.
            return found
        ambiguous = False
        if found is None:
            from facefusion import face_detector
            from facefusion.face_helper import apply_nms
            boxes, scores, _ = face_detector.detect_faces(image)
            ambiguous = len(apply_nms(boxes, scores, .6, .4)) > 1
        identity = None
        if found is not None:
            from facefusion.face_recognizer import calculate_face_embedding
            _, embedding = calculate_face_embedding(image, found[1])
            identity = np.asarray(embedding, np.float32).reshape(-1).tolist()
        return {'face': _face_json(found), 'ambiguous': ambiguous, 'identity': identity}

    def detect_hands(self, image):
        palms = self.palm.infer(image)
        self.models['palm']['used'] = True
        hands = []
        uncertain = False
        for candidate in palms:
            value = self.hand.infer(image, candidate)
            self.models['hand']['used'] = True
            if value is None:
                uncertain = True
                continue
            points = np.asarray(value[4:67], np.float32).reshape(21, 3)
            score = float(value[-1])
            if not np.isfinite(value).all() or score < TRACKING['seed_score']:
                uncertain = True
                continue
            hands.append({'box': np.asarray(value[:4], np.float32).tolist(),
                          'points': points.tolist(), 'score': score})
        return {'hands': hands, 'uncertain': uncertain, 'palms': len(palms)}

    def arc_affine(self, five):
        from facefusion.face_helper import estimate_matrix_by_face_landmark_5
        return estimate_matrix_by_face_landmark_5(np.asarray(five, np.float32), 'arcface_128', (512, 512))

    def dense(self, image, seed):
        if seed is None:
            raise ValueError('A real source landmark seed is required; no centered fallback.')
        if self.landmark_session is None:
            import onnxruntime as ort
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 1
            opts.inter_op_num_threads = 1
            self.landmark_session = ort.InferenceSession(str(self.root / 'landmark203.onnx'), sess_options=opts,
                                                        providers=['CUDAExecutionProvider'])
            if self.landmark_session.get_providers()[0] != 'CUDAExecutionProvider':
                raise ValueError('Landmark CUDA provider unavailable; no automatic CPU fallback.')
            self.landmark_session.disable_fallback()
            self.models['landmark203'].update(providerVerified=True, runtimeProviders=self.landmark_session.get_providers())
        crop = crop_image(image[:, :, ::-1], np.asarray(seed, np.float32), dsize=224, scale=1.5, vy_ratio=-.1)
        tensor = np.ascontiguousarray(crop['img_crop'].transpose(2, 0, 1)[None], np.float32) / 255
        outputs = self.landmark_session.run(None, {'input': tensor})
        self.models['landmark203']['used'] = True
        points = np.asarray(outputs[2][0], np.float32).reshape(203, 2) * 224
        return _transform_pts(points, crop['M_c2o']).astype(np.float32)

    def dense_affine(self, image, points):
        return crop_image(image, points, dsize=512, scale=1.5, vy_ratio=-.125)['M_o2c'][:2]

    def _sam(self):
        if self.predictor is not None:
            return self.predictor
        import torch
        from facial_occlusion_runtime import source_root, source_ready
        if not torch.cuda.is_available() or not source_ready(verify=True):
            raise ValueError('Prepare the pinned CUDA hand-tracking runtime explicitly before rendering.')
        sys.path.insert(0, str(source_root()))
        from sam2.build_sam import build_sam2_video_predictor
        self.predictor = build_sam2_video_predictor('configs/sam2.1/sam2.1_hiera_t.yaml',
            str(self.root / 'sam2.1_hiera_tiny.pt'), device='cuda', apply_postprocessing=False)
        self.predictor.float()
        parameter = next(self.predictor.parameters())
        if parameter.device.type != 'cuda' or parameter.dtype != torch.float32:
            raise ValueError('SAM hand tracking did not initialize on FP32 CUDA.')
        self.models['sam2'].update(providerVerified=True, runtimeProviders=['Torch CUDA FP32'])
        # Official predictor stores BF16 memories unconditionally. This instance
        # runs FP32, so normalize only its returned memory tensors. Do not patch
        # source files, ComfyUI, global Torch settings or other predictors.
        single, encoder = self.predictor._run_single_frame_inference, self.predictor._run_memory_encoder
        def single_fp32(*args, **kwargs):
            result, masks = single(*args, **kwargs)
            if result.get('maskmem_features') is not None:
                result['maskmem_features'] = result['maskmem_features'].float()
            return result, masks
        def encoder_fp32(*args, **kwargs):
            features, position = encoder(*args, **kwargs)
            return features.float() if features is not None else None, position
        self.predictor._run_single_frame_inference = single_fp32
        self.predictor._run_memory_encoder = encoder_fp32
        return self.predictor

    def segment_chunk(self, files, observations, cancelled):
        images = [cv2.imread(str(file)) for file in files]
        shape = images[0].shape[:2]
        masks = [np.zeros(shape, bool) for _ in images]
        tracks = hand_tracks(observations)
        if len(tracks) > TRACKING['maximum_objects_per_chunk']:
            return masks, ['unavailable'] * len(images), {'reason': 'too-many-hand-tracks'}
        if not tracks:
            states = ['unavailable' if v['uncertain'] or v['palms'] else 'known-none' for v in observations]
            return masks, states, {'objects': 0}
        import torch
        predictor = self._sam()
        temporary = Path(files[0]).parent / ('sam-chunk-' + Path(files[0]).stem)
        if temporary.is_symlink():
            raise ValueError('Invalid SAM scratch directory.')
        temporary.mkdir(exist_ok=True)
        try:
            for i, image in enumerate(images):
                cv2.imwrite(str(temporary / f'{i:05d}.jpg'), image, [cv2.IMWRITE_JPEG_QUALITY, 100])
            for track in tracks:
                _cancel(cancelled)
                hand, seed = track['seed'], track['seedFrame']
                points = np.asarray(hand['points'], np.float32)[:, :2]
                positive = np.vstack([points[[0, 5, 9, 13, 17]], points[[5, 9, 13, 17]].mean(0)])
                h, w = shape
                positive = np.clip(positive, [1, 1], [w - 2, h - 2])
                box = np.r_[np.maximum(np.minimum(hand['box'][:2], positive.min(0) - 12), [0, 0]),
                            np.minimum(np.maximum(hand['box'][2:], positive.max(0) + 12), [w - 1, h - 1])]
                corners = np.array([[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]], np.float32)
                negative = corners[(corners[:, 0] < box[0]) | (corners[:, 0] > box[2]) |
                                   (corners[:, 1] < box[1]) | (corners[:, 1] > box[3])]
                coordinates = np.vstack([positive, negative])
                labels = np.r_[np.ones(len(positive), np.int32), np.zeros(len(negative), np.int32)]
                with torch.inference_mode(), torch.autocast(device_type='cuda', enabled=False):
                    state = predictor.init_state(str(temporary), offload_video_to_cpu=True, offload_state_to_cpu=True)
                    try:
                        _, _, logits = predictor.add_new_points_or_box(state, frame_idx=seed, obj_id=1,
                            points=coordinates, labels=labels, box=box)
                        self.models['sam2']['used'] = True
                        first_logits = logits[0, 0].float().cpu().numpy()
                        if not np.isfinite(first_logits).all():
                            return masks, ['unavailable'] * len(images), {'reason': 'nonfinite-hand-mask'}
                        first = first_logits > 0
                        q = np.rint(coordinates).astype(int)
                        values = first[q[:, 1], q[:, 0]]
                        if values[:len(positive)].mean() < TRACKING['positive_seed_coverage'] or (len(negative) and values[len(positive):].mean() > TRACKING['negative_seed_coverage']):
                            return masks, ['unavailable'] * len(images), {'reason': 'unreliable-hand-seed'}
                        for reverse in [True, False]:
                            for i, _, logits in predictor.propagate_in_video(state, start_frame_idx=seed, reverse=reverse):
                                _cancel(cancelled)
                                raw_logits = logits[0, 0].float().cpu().numpy()
                                if not np.isfinite(raw_logits).all():
                                    return masks, ['unavailable'] * len(images), {'reason': 'nonfinite-hand-mask'}
                                mask = _holes(raw_logits > 0)
                                if float(mask.mean()) >= TRACKING['maximum_mask_fraction']:
                                    return masks, ['unavailable'] * len(images), {'reason': 'unbounded-hand-mask'}
                                masks[i] |= mask
                    finally:
                        predictor.reset_state(state)
                        del state
            states = []
            for mask, observation in zip(masks, observations):
                valid = not observation['uncertain'] and float(mask.mean()) < TRACKING['maximum_mask_fraction']
                for hand in observation['hands']:
                    p = np.rint(np.asarray(hand['points'])[[0, 5, 9, 13, 17], :2]).astype(int)
                    p[:, 0] = np.clip(p[:, 0], 0, shape[1] - 1)
                    p[:, 1] = np.clip(p[:, 1], 0, shape[0] - 1)
                    valid &= mask[p[:, 1], p[:, 0]].mean() >= TRACKING['positive_seed_coverage']
                states.append('unavailable' if not valid else 'segmented' if mask.any() else 'known-none')
            return masks, states, {'objects': len(tracks), 'independentObjectUnion': True}
        finally:
            import shutil
            shutil.rmtree(temporary)

    def close(self):
        self.release_sam()
        self.landmark_session = None
        gc.collect()

    def release_sam(self):
        self.predictor = None
        gc.collect()
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()


class OcclusionState:
    def __init__(self, folder, receipt):
        self.folder = Path(folder)
        self.receipt = receipt
        self.receipt_path = self.folder / 'receipt.json'
        self.receipt_sha256 = _sha(self.receipt_path)
        self.records = {row['frame']: row for row in receipt['records']}
        if not receipt.get('complete') or sorted(self.records) != list(range(receipt['frames'])) or len(receipt['records']) != receipt['frames']:
            raise ValueError('The occlusion receipt is incomplete or has duplicate frames.')

    def frame(self, index):
        row = self.records[index]
        if row['file'] != f'frames/{index:06d}.npz':
            raise ValueError('Invalid occlusion cache frame path.')
        file = self.folder / row['file']
        if _sha(file) != row['sha256']:
            raise ValueError('A bound hand/partial-face frame cache changed.')
        with np.load(file, allow_pickle=False) as z:
            value = {k: z[k].copy() for k in z.files}
        value.update(row)
        value['cacheSHA256'] = row['sha256']
        value['source203'] = value['source203'] if row['trackValid'] else None
        value['sourceAffine'] = value['sourceAffine'] if row['trackValid'] else None
        value['sourceFace'] = _face_arrays(row.get('sourceFace'))
        value['targetFace'] = _face_arrays(row.get('targetFace'))
        value['trackBinding'] = next((x for x in self.receipt['trackBindings'] if x['sha256'] == row['trackBindingSHA256']), None)
        return value


def prepare_occlusion(folder, inputs, info, face_fn, progress, cancelled, *, model_root=None, backend=None):
    """Prepare before FaceModels; returns only verified same-input frame caches.

    progress(completed,total,stage); cancelled() may raise or return True.
    Backend injection is exclusively for bounded tests; production uses pinned
    local ModelBackend. Source and target are decoded independently on24fps.
    """
    folder = Path(folder)
    out = folder / 'result/occlusion'
    if out.is_symlink():
        raise ValueError('Invalid occlusion cache directory.')
    out.mkdir(parents=True, exist_ok=True)
    n, w, h = info['frames'], info['width'], info['height']
    if type(n) is not int or not 1 <= n <= 720 or any(type(v) is not int or v < 64 for v in [w, h]) or Fraction(str(info['fps'])) != 24:
        raise ValueError('Invalid occlusion source clock or dimensions.')
    request = inputs['request']
    if request.get('version') != 'source-face-v11' or not isinstance(request.get('jobId'), str):
        raise ValueError('Occlusion preparation requires its versioned job binding.')
    try:
        if str(uuid.UUID(request['jobId'])) != request['jobId']:
            raise ValueError('Noncanonical tracking job UUID.')
    except (ValueError, AttributeError):
        raise ValueError('Invalid tracking job UUID.') from None
    hashes = {'sourceSHA256': inputs['sourceSHA256'], 'rawSHA256': inputs['baseSHA256'],
              'referenceSHA256': inputs['referenceSHA256'], 'profileSHA256': request['profileSHA256']}
    for key, name in [('sourceSHA256', 'source.mp4'), ('rawSHA256', 'target.mp4'), ('referenceSHA256', 'reference.png')]:
        if _sha(folder / name) != hashes[key]:
            raise ValueError('A hand-tracking input changed; earlier results were preserved.')
    manifest_file = ROOT / 'config/facial-consistency-occlusion-models.lock.json'
    binding = {**hashes, 'jobId': request['jobId'], 'requestVersion': request['version'],
               'frames': n, 'width': w, 'height': h, 'fps': '24/1',
               'policySHA256': POLICY_SHA256, 'controllerSHA256': _sha(__file__),
               'modelManifestSHA256': _sha(manifest_file)}
    receipt_file = out / 'receipt.json'
    if receipt_file.exists():
        receipt = json.loads(receipt_file.read_text())
        if receipt.get('binding') != binding:
            raise ValueError('Saved occlusion preparation belongs to different inputs or tools.')
        if receipt.get('complete'):
            state = OcclusionState(out, receipt)
            for i in range(n):
                _cancel(cancelled)
                state.frame(i)
            return state
    else:
        receipt = {'version': VERSION, 'complete': False, **binding, 'binding': binding,
                   'sourceRGBTransferred': False, 'records': [], 'trackBindings': [], 'banks': {}}
        _atomic(receipt_file, receipt)
    backend = backend or ModelBackend(model_root)
    # An interrupted preparation may reuse masks generated in an earlier
    # process. Preserve that actual model-use provenance without forcing a new
    # warmup/inference merely to make an unused-stage flag true.
    for name, old in receipt.get('models', {}).items():
        current = backend.models.get(name)
        if current is None or any(current.get(k) != old.get(k) for k in ['sha256', 'size', 'providers']):
            backend.close()
            raise ValueError('The resumed tracking model/provider binding changed.')
        if old.get('used') is True:
            current['used'] = True
            current['providerVerified'] = bool(old.get('providerVerified') or current.get('providerVerified'))
            if old.get('runtimeProviders') and not current.get('runtimeProviders'):
                current['runtimeProviders'] = old['runtimeProviders']
    receipt['models'] = backend.models
    receipt['associationScope'] = 'bounded-single-person-continuous-clip; cuts/cars/arbitrary-occluders not validated'
    try:
        # Scan every source AND target frame, not just an early prompt window.
        for role, filename in [('source', 'source.mp4'), ('target', 'target.mp4')]:
            root = out / role
            if root.is_symlink():
                raise ValueError('Invalid occlusion bank directory.')
            root.mkdir(exist_ok=True)
            bank = receipt['banks'].setdefault(role, {'observations': [], 'chunks': []})
            cap = cv2.VideoCapture(str(folder / filename))
            try:
                for i in range(n):
                    _cancel(cancelled)
                    ok, image = cap.read()
                    if not ok:
                        raise ValueError('The exact hand-tracking source frame is unavailable.')
                    if image.shape[:2] != (h, w):
                        image = cv2.resize(image, (w, h), interpolation=cv2.INTER_AREA)
                    pixel_sha = hashlib.sha256(image.tobytes()).hexdigest()
                    file = root / f'{i:06d}.png'
                    if i < len(bank['observations']):
                        old = bank['observations'][i]
                        if old['decodedSHA256'] != pixel_sha or _sha(file) != old['fileSHA256']:
                            raise ValueError('Saved decoded tracking pixels changed.')
                        continue
                    hands = backend.detect_hands(image)
                    observation = backend.observe_face(image, face_fn)
                    if not isinstance(observation, dict) or type(observation.get('ambiguous')) is not bool:
                        raise ValueError('Face observation must distinguish multiple from absent.')
                    cv2.imwrite(str(file), image)
                    bank['observations'].append({'frame': i, 'decodedSHA256': pixel_sha, 'fileSHA256': _sha(file),
                        'hands': hands, 'face': observation.get('face'), 'ambiguous': observation['ambiguous'],
                        'identity': observation.get('identity')})
                    _atomic(receipt_file, receipt)
                    progress(i + 1, n, 'Inspecting ' + role + ' hands and faces')
                if cap.read()[0]:
                    raise ValueError('Tracking video contains unexpected extra frames.')
            finally:
                cap.release()
            for start in range(0, n, TRACKING['chunk_frames']):
                _cancel(cancelled)
                end = min(n, start + TRACKING['chunk_frames'])
                old = next((x for x in bank['chunks'] if x['start'] == start), None)
                if old is not None:
                    for item in old['records']:
                        if _sha(root / item['file']) != item['sha256']:
                            raise ValueError('A saved hand-mask chunk changed.')
                    continue
                files = [root / f'{i:06d}.png' for i in range(start, end)]
                masks, states, detail = backend.segment_chunk(files, [x['hands'] for x in bank['observations'][start:end]], cancelled)
                if len(masks) != end - start or len(states) != end - start:
                    raise ValueError('Incomplete hand mask chunk.')
                chunk = {'start': start, 'end': end, 'records': [], 'detail': detail}
                for i, mask, status in zip(range(start, end), masks, states):
                    _cancel(cancelled)
                    mask = np.asarray(mask, bool)
                    if mask.shape != (h, w) or status not in ['segmented', 'known-none', 'unavailable'] or status == 'known-none' and mask.any():
                        raise ValueError('Invalid hand mask state.')
                    file = root / f'{i:06d}-hand.png'
                    cv2.imwrite(str(file), mask.astype(np.uint8) * 255)
                    chunk['records'].append({'frame': i, 'file': file.name, 'sha256': _sha(file), 'state': status})
                bank['chunks'].append(chunk)
                _atomic(receipt_file, receipt)
                progress(end, n, 'Tracking ' + role + ' foreground')
        # Release SAM before landmark preparation and facial generators.
        if hasattr(backend, 'release_sam'):
            backend.release_sam()
        source = receipt['banks']['source']['observations']
        source_masks = {x['frame']: x for c in receipt['banks']['source']['chunks'] for x in c['records']}
        target_masks = {x['frame']: x for c in receipt['banks']['target']['chunks'] for x in c['records']}
        # Multiple-face frames are barriers. Source identity changes begin a new
        # association track; a missing span bracketed by different tracks fails.
        track, previous_identity, barrier = 0, None, False
        for row in source:
            row['trackId'] = None
            if row['ambiguous']:
                previous_identity, barrier = None, True
                continue
            if row['face'] is None:
                continue
            identity = np.asarray(row['identity'], np.float32) if row['identity'] is not None else None
            if identity is None or identity.ndim != 1 or not np.isfinite(identity).all() or np.linalg.norm(identity) < .1:
                barrier = True
                continue
            identity = identity / np.linalg.norm(identity)
            if previous_identity is None or barrier or 1 - float(identity @ previous_identity) > TRACKING['maximum_source_face_distance']:
                track += 1
            row['trackId'] = 'person-' + str(track)
            previous_identity, barrier = identity, False
        geometries = {}
        i = 0
        while i < n:
            if source[i]['face'] is not None or source[i]['ambiguous']:
                i += 1
                continue
            start = i
            while i < n and source[i]['face'] is None and not source[i]['ambiguous']:
                i += 1
            end = i
            if end - start > TRACKING['maximum_partial_span_frames']:
                continue
            left = source[start - 1].get('trackId') if start else None
            right = source[end].get('trackId') if end < n else None
            ids = {x for x in [left, right] if x}
            if len(ids) != 1:
                continue
            person = next(iter(ids))
            track_id = person + '-partial-' + str(start) + '-' + str(end)
            candidates = []
            for row in source:
                if row.get('trackId') == person and row['face'] is not None:
                    candidates.append({'frame': row['frame'], 'sourceSHA256': hashes['sourceSHA256'],
                        'trackId': track_id, 'shotId': person, 'primaryValid': True,
                        'clear': _clear_anchor(row, source_masks[row['frame']], out / 'source'),
                        'ambiguous': row['ambiguous']})
            anchor = choose_clear_anchor(candidates, missing_span=(start, end), frame_count=n,
                source_sha=hashes['sourceSHA256'], track_id=track_id, shot_id=person)
            if anchor is None or min(abs(anchor['frame'] - start), abs(anchor['frame'] - end + 1)) > TRACKING['maximum_partial_span_frames']:
                continue
            a = anchor['frame']
            order = range(a, start - 1, -1) if a >= end else range(a, end)
            path = out / 'tracks' / track_id
            path.mkdir(parents=True, exist_ok=True)
            previous = None
            frozen = next((x for x in receipt['trackBindings'] if x['trackId'] == track_id), None)
            for j in order:
                _cancel(cancelled)
                image = cv2.imread(str(out / 'source' / f'{j:06d}.png'))
                file = path / f'{j:06d}.npz'
                metadata_file = path / f'{j:06d}.json'
                if metadata_file.exists():
                    metadata = json.loads(metadata_file.read_text())
                    if _sha(file) != metadata['sha256'] or metadata['sourceDecodedSHA256'] != source[j]['decodedSHA256']:
                        raise ValueError('Saved source landmark tracking changed.')
                    with np.load(file, allow_pickle=False) as z:
                        points, affine = z['source203'].copy(), z['official203'].copy()
                else:
                    seed = np.asarray(source[a]['face']['landmark68'], np.float32) if previous is None else previous
                    points = backend.dense(image, seed)
                    if np.asarray(points).shape != (203, 2) or not np.isfinite(points).all():
                        break
                    affine = backend.dense_affine(image, points)
                    np.savez_compressed(file, source203=points, official203=affine)
                    _atomic(metadata_file, {'sha256': _sha(file), 'sourceDecodedSHA256': source[j]['decodedSHA256']})
                if j == a:
                    frozen = freeze_alignment(backend.arc_affine(source[a]['face']['five']), affine,
                        source_sha=hashes['sourceSHA256'], track_id=track_id, shot_id=person,
                        anchor_frame=a, frame_count=n, existing=frozen)
                    if not any(x['trackId'] == track_id for x in receipt['trackBindings']):
                        receipt['trackBindings'].append(frozen)
                        _atomic(receipt_file, receipt)
                mapped = tracked_arc5(affine, frozen, source_sha=hashes['sourceSHA256'], track_id=track_id,
                    shot_id=person, frame_count=n)
                if start <= j < end:
                    geometries[j] = (points, mapped, frozen['sha256'])
                previous = points
                progress(j + 1, n, 'Tracking partial source face')
        frames = out / 'frames'
        frames.mkdir(exist_ok=True)
        receipt['records'] = []
        for i in range(n):
            _cancel(cancelled)
            sm, tm = source_masks[i], target_masks[i]
            source_mask = cv2.imread(str(out / 'source' / sm['file']), 0) > 0
            target_mask = cv2.imread(str(out / 'target' / tm['file']), 0) > 0
            veto, hard = foreground_veto(target_mask, shape=(h, w), state=tm['state'])
            points, affine, track_sha = geometries.get(i, (np.empty((0, 2), np.float32), np.empty((0, 3), np.float64), None))
            file = frames / f'{i:06d}.npz'
            np.savez_compressed(file, sourceHandMask=source_mask, targetVeto=veto, targetHard=hard,
                                source203=points, sourceAffine=affine)
            receipt['records'].append({'frame': i, 'file': 'frames/' + file.name, 'sha256': _sha(file),
                'sourceMaskState': sm['state'], 'targetMaskState': tm['state'], 'trackValid': i in geometries,
                'trackBindingSHA256': track_sha, 'sourceDecodedSHA256': source[i]['decodedSHA256'],
                'targetDecodedSHA256': receipt['banks']['target']['observations'][i]['decodedSHA256'],
                'sourceFace': source[i]['face'], 'targetFace': receipt['banks']['target']['observations'][i]['face'],
                'sourceAmbiguous': source[i]['ambiguous'], 'targetAmbiguous': receipt['banks']['target']['observations'][i]['ambiguous']})
        receipt['complete'] = True
        _atomic(receipt_file, receipt)
        return OcclusionState(out, receipt)
    finally:
        # Both owned and injected backends must release their preparation stage.
        # Keep actual stage-use provenance even if cancellation occurs between
        # model completion and a chunk commit; never mark that chunk complete.
        receipt['models'] = backend.models
        try:
            _atomic(receipt_file, receipt)
        finally:
            backend.close()
