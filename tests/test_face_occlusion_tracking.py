import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from face_occlusion_tracking import prepare_occlusion, hand_tracks


def digest(file):
    return hashlib.sha256(Path(file).read_bytes()).hexdigest()


class FakeBackend:
    """Pixel-clock callbacks only; never imports a neural runtime."""
    def __init__(self, source_faces=None, identities=None, ambiguous=(), unknown_target=(),
                 covered_primary=(), unknown_source=()):
        self.source_faces = source_faces if source_faces is not None else [False, False, True, True, True, True]
        self.identities = identities or {}
        self.ambiguous = set(ambiguous)
        self.unknown_target = set(unknown_target)
        self.covered_primary = set(covered_primary)
        self.unknown_source = set(unknown_source)
        self.models = {k: {'sha256': 'b' * 64, 'size': 1, 'providers': ['Fake'], 'used': False,
                           'providerVerified': True} for k in ['landmark203', 'palm', 'hand', 'sam2']}
        self.calls = {'hands': 0, 'faces': 0, 'dense': 0, 'chunks': 0}
        self.closed = False

    @staticmethod
    def position(image):
        return int((int(image[0, 0, 0]) - 5) // 20), bool(image[0, 0, 2] > 100)

    def observe_face(self, image, face_fn):
        self.calls['faces'] += 1
        i, target = self.position(image)
        present = target or self.source_faces[i]
        five = [[20, 22], [44, 22], [32, 33], [24, 44], [40, 44]]
        points = np.tile([32., 32.], (68, 1)).astype(np.float32)
        for ids, x in [(range(36, 42), 20), (range(42, 48), 44)]:
            for n, k in enumerate(ids):
                angle = n * np.pi / 3
                points[k] = [x + 5 * np.cos(angle), 22 + 3 * np.sin(angle)]
        face = {'box': [10., 8., 54., 58.], 'five': five, 'landmark68': points.tolist()} if present else None
        return {'face': face, 'ambiguous': not target and i in self.ambiguous,
                'identity': self.identities.get(i, [1., 0.]) if present else None}

    def detect_hands(self, image):
        self.calls['hands'] += 1
        self.models['palm']['used'] = True
        i, target = self.position(image)
        return {'hands': [], 'uncertain': False, 'palms': 0, 'index': i, 'target': target}

    def segment_chunk(self, files, observations, cancelled):
        self.calls['chunks'] += 1
        masks, states = [], []
        for row in observations:
            mask = np.zeros((64, 64), bool)
            covered = not row['target'] and (not self.source_faces[row['index']] or row['index'] in self.covered_primary)
            if covered:
                mask[:, 40:] = True
                self.models['sam2']['used'] = True
            masks.append(mask)
            unknown = row['index'] in (self.unknown_target if row['target'] else self.unknown_source)
            states.append('unavailable' if unknown else 'segmented' if covered else 'known-none')
        return masks, states, {'fake': True}

    def dense(self, image, seed):
        self.calls['dense'] += 1
        self.models['landmark203']['used'] = True
        p = np.full((203, 2), 32., np.float32)
        for start, x in [(0, 20), (24, 44)]:
            angles = np.arange(24) * 2 * np.pi / 24
            p[start:start + 24] = np.column_stack([x + 5 * np.cos(angles), 22 + 3 * np.sin(angles)])
        angles = np.arange(60) * 2 * np.pi / 60
        p[48:108] = np.column_stack([32 + 8 * np.cos(angles), 45 + 3 * np.sin(angles)])
        return p

    def arc_affine(self, five):
        return np.array([[8., 0., 0.], [0., 8., 0.]])

    def dense_affine(self, image, points):
        return self.arc_affine(None)

    def close(self):
        self.closed = True


class OcclusionTrackingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name)
        for name, color in [('source', 40), ('target', 150)]:
            avi = self.folder / (name + '.avi')
            writer = cv2.VideoWriter(str(avi), cv2.VideoWriter_fourcc(*'FFV1'), 24, (64, 64))
            if not writer.isOpened():
                self.skipTest('OpenCV FFV1 writer unavailable')
            for i in range(6):
                writer.write(np.full((64, 64, 3), [5 + 20 * i, 40, color], np.uint8))
            writer.release()
            avi.rename(self.folder / (name + '.mp4'))
        cv2.imwrite(str(self.folder / 'reference.png'), np.full((64, 64, 3), 80, np.uint8))
        self.inputs = {'sourceSHA256': digest(self.folder / 'source.mp4'),
                       'baseSHA256': digest(self.folder / 'target.mp4'),
                       'referenceSHA256': digest(self.folder / 'reference.png'),
                       'request': {'profileSHA256': 'a' * 64, 'jobId': '1e3d2233-72b2-4a13-8496-c9c85c7003f5',
                                   'version': 'source-face-v11'}}
        self.info = {'frames': 6, 'width': 64, 'height': 64, 'fps': 24}

    def tearDown(self):
        self.tmp.cleanup()

    def prepare(self, backend, cancelled=lambda: False):
        return prepare_occlusion(self.folder, self.inputs, self.info,
                                 lambda _: self.fail('Fake backend called a real face detector'),
                                 lambda *_: None, cancelled, backend=backend)

    def test_independent_banks_all_frames_and_dynamic_later_anchor(self):
        backend = FakeBackend(unknown_target=[1])
        state = self.prepare(backend)
        self.assertTrue(backend.closed)
        self.assertEqual(backend.calls['hands'], 12)
        self.assertEqual(backend.calls['faces'], 12)
        self.assertEqual(backend.calls['chunks'], 2)
        self.assertEqual(state.receipt['version'], 'source-occlusion-v1')
        self.assertEqual(state.receipt['trackBindings'][0]['anchorFrame'], 2)
        self.assertTrue(state.frame(0)['trackValid'])
        self.assertIsNone(state.frame(3)['source203'])
        self.assertEqual(state.frame(0)['cacheSHA256'], state.receipt['records'][0]['sha256'])
        self.assertEqual(state.frame(0)['targetMaskState'], 'known-none')
        self.assertTrue(np.all(state.frame(0)['targetVeto'] == 1))
        self.assertEqual(state.frame(1)['targetMaskState'], 'unavailable')
        self.assertFalse(np.any(state.frame(1)['targetVeto']))
        self.assertTrue(np.all(state.frame(1)['targetHard']))
        self.assertFalse(state.receipt['sourceRGBTransferred'])

    def test_complete_resume_never_calls_backend_or_changes_anchor(self):
        first = self.prepare(FakeBackend())
        old_sha = first.receipt_sha256
        unused = FakeBackend()
        second = self.prepare(unused)
        self.assertEqual(old_sha, second.receipt_sha256)
        self.assertFalse(any(unused.calls.values()))
        self.assertEqual(first.receipt['trackBindings'], second.receipt['trackBindings'])

    def test_clear_nohand_clip_does_not_claim_sam_or_landmark_inference(self):
        state = self.prepare(FakeBackend(source_faces=[True] * 6))
        self.assertTrue(state.receipt['models']['palm']['used'])
        for name in ['hand', 'sam2', 'landmark203']:
            self.assertFalse(state.receipt['models'][name]['used'])
        self.assertEqual(state.receipt['trackBindings'], [])

    def test_partial_resume_preserves_prior_model_use_provenance(self):
        backend = FakeBackend()
        count = [0]
        def cancel():
            count[0] += 1
            # Stop after the source model stage, before its chunk commit.
            return backend.calls['chunks'] == 1
        with self.assertRaises(InterruptedError):
            self.prepare(backend, cancel)
        before = json.loads((self.folder / 'result/occlusion/receipt.json').read_text())
        self.assertTrue(before['models']['sam2']['used'])
        state = self.prepare(FakeBackend())
        self.assertTrue(state.receipt['models']['sam2']['used'])

    def test_identical_inputs_from_different_job_cannot_reuse_cache(self):
        self.prepare(FakeBackend())
        self.inputs['request']['jobId'] = '2e3d2233-72b2-4a13-8496-c9c85c7003f5'
        with self.assertRaisesRegex(ValueError, 'different inputs'):
            self.prepare(FakeBackend())

    def test_cancel_keeps_verified_prefix_and_resume_finishes(self):
        calls = [0]
        def cancel():
            calls[0] += 1
            return calls[0] == 4
        first = FakeBackend()
        with self.assertRaises(InterruptedError):
            self.prepare(first, cancel)
        self.assertTrue(first.closed)
        file = self.folder / 'result/occlusion/receipt.json'
        partial = json.loads(file.read_text())
        self.assertFalse(partial['complete'])
        prefix = partial['banks']['source']['observations']
        self.assertEqual(len(prefix), 3)
        second = FakeBackend()
        state = self.prepare(second)
        self.assertTrue(state.receipt['complete'])
        self.assertEqual(second.calls['faces'], 9)
        self.assertEqual(prefix[0]['fileSHA256'], state.receipt['banks']['source']['observations'][0]['fileSHA256'])

    def test_multiple_face_none_is_not_partial_continuation(self):
        state = self.prepare(FakeBackend(ambiguous=[0]))
        self.assertFalse(state.frame(0)['trackValid'])
        self.assertTrue(state.frame(0)['sourceAmbiguous'])

    def test_different_people_bracketing_missing_span_refuse_tracking(self):
        backend = FakeBackend(source_faces=[True, False, False, True, True, True],
                              identities={3: [0., 1.], 4: [0., 1.], 5: [0., 1.]})
        state = self.prepare(backend)
        self.assertFalse(state.frame(1)['trackValid'])
        self.assertFalse(state.frame(2)['trackValid'])
        self.assertEqual(backend.calls['dense'], 0)

    def test_detected_but_hand_covered_anchor_is_not_clear(self):
        state = self.prepare(FakeBackend(covered_primary=[2]))
        self.assertEqual(state.receipt['trackBindings'][0]['anchorFrame'], 3)

    def test_unknown_source_mask_cannot_establish_clear_anchor(self):
        state = self.prepare(FakeBackend(unknown_source=[2, 3, 4, 5]))
        self.assertFalse(state.frame(0)['trackValid'])
        self.assertEqual(state.receipt['trackBindings'], [])

    def test_changed_bound_reference_and_frame_cache_are_rejected(self):
        state = self.prepare(FakeBackend())
        frame = self.folder / 'result/occlusion' / state.receipt['records'][0]['file']
        frame.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'cache changed'):
            state.frame(0)
        with self.assertRaises(ValueError):
            self.prepare(FakeBackend())
        cv2.imwrite(str(self.folder / 'reference.png'), np.zeros((64, 64, 3), np.uint8))
        self.inputs['referenceSHA256'] = digest(self.folder / 'reference.png')
        with self.assertRaisesRegex(ValueError, 'different inputs'):
            self.prepare(FakeBackend())

    def test_later_and_multiple_hands_get_independent_seed_tracks(self):
        def hand(box, score=.95):
            return {'box': box, 'points': [[0, 0, 0]] * 21, 'score': score}
        rows = [{'hands': []}, {'hands': [hand([0, 0, 10, 10])]},
                {'hands': [hand([1, 0, 11, 10], .99), hand([30, 30, 40, 40])]}]
        tracks = hand_tracks(rows)
        self.assertEqual(len(tracks), 2)
        self.assertEqual([x['seedFrame'] for x in tracks], [2, 2])


if __name__ == '__main__':
    unittest.main()
