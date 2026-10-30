"""Protect source performance and frozen-anchor recovery in the new recipe."""
from pathlib import Path
import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from face_eye_calibration import EyeCalibration, EYES, JAW, matching_pose
from face_performance import compose_expression
import facial_worker


def fixture(eligible=(True, True)):
    rng = np.random.default_rng(2718)
    anchor = {'exp': rng.normal(0, .02, (1, 49, 3)).astype(np.float32),
              'kp': np.column_stack([np.arange(49), np.zeros((49, 2))]).astype(np.float32)[None]}
    reference = {'exp': rng.normal(0, .04, (1, 49, 3)).astype(np.float32)}
    labels = np.zeros((512, 512), np.uint8)
    labels[200:220, 160:190] = 4
    labels[200:220, 320:350] = 5
    return EyeCalibration(reference, anchor, labels, list(eligible)), rng, labels


class EyeCalibrationTests(unittest.TestCase):
    def test_different_reference_expression_cannot_close_speaking_source_mouth(self):
        model, rng, labels = fixture()
        source, target = [rng.normal(0, .1, (1, 49, 3)).astype(np.float32) for _ in range(2)]
        result, record = model.apply(source, target, labels)
        self.assertTrue(np.array_equal(result[:, :8], source[:, :8]))
        self.assertTrue(np.array_equal(result[:, JAW], compose_expression(target, source, False)[:, JAW]))
        self.assertTrue(record['sourceMouthLatentUnchanged'])
        self.assertTrue(record['sourceJawLatentUnchanged'])

    def test_reference_horizontal_eye_expression_never_overrides_source(self):
        model, rng, labels = fixture()
        source, target = [rng.normal(size=(1, 49, 3)).astype(np.float32) for _ in range(2)]
        result, _ = model.apply(source, target, labels)
        self.assertTrue(np.array_equal(result[:, EYES, 0], source[:, EYES, 0]))
        self.assertFalse(np.array_equal(result[:, EYES, 1], source[:, EYES, 1]))

    def test_closed_source_eye_receives_no_vertical_calibration(self):
        model, rng, labels = fixture()
        labels[:, :256] = 0
        source, target = [rng.normal(size=(1, 49, 3)).astype(np.float32) for _ in range(2)]
        result, record = model.apply(source, target, labels)
        self.assertEqual(record['eyeCalibrationWeights'], [0., 1.])
        self.assertTrue(np.array_equal(result[:, model.eye_groups[0], 1], source[:, model.eye_groups[0], 1]))

    def test_hidden_anchor_eye_is_not_invented_when_it_later_opens(self):
        model, rng, labels = fixture((False, True))
        source, target = [rng.normal(size=(1, 49, 3)).astype(np.float32) for _ in range(2)]
        result, record = model.apply(source, target, labels)
        self.assertEqual(record['eyeCalibrationWeights'][0], 0.)
        self.assertTrue(np.array_equal(result[:, model.eye_groups[0]], source[:, model.eye_groups[0]]))

    def test_saved_motion_round_trips_without_reinterpreting_the_anchor(self):
        model, rng, labels = fixture()
        saved = json.loads(json.dumps(model.freeze()))
        restored = EyeCalibration.restore(saved)
        source, target = [rng.normal(size=(1, 49, 3)).astype(np.float32) for _ in range(2)]
        self.assertTrue(np.array_equal(model.offset, restored.offset))
        self.assertEqual(model.describe(), restored.describe())
        self.assertTrue(np.array_equal(model.apply(source, target, labels)[0], restored.apply(source, target, labels)[0]))

    def test_saved_mouth_horizontal_eye_and_hidden_eye_edits_are_rejected(self):
        model, _, _ = fixture((False, True))
        for point, channel in [(0, 1), (44, 1), (27, 0), (27, 2)]:
            saved = copy.deepcopy(model.freeze())
            saved['offset'][0][point][channel] = .3
            with self.subTest(point=point, channel=channel), self.assertRaises(ValueError):
                EyeCalibration.restore(saved)

    def test_invalid_groups_hashes_and_motion_are_rejected(self):
        model, _, _ = fixture()
        for change in [lambda s: s.update(correctionSHA256='0' * 64),
                       lambda s: s['eyeGroups'][1].__setitem__(0, 27),
                       lambda s: s.update(baselineEyeAreas=[float('nan'), 500]),
                       lambda s: s['offset'][0][15].__setitem__(1, float('inf'))]:
            saved = copy.deepcopy(model.freeze())
            change(saved)
            with self.assertRaises(ValueError):
                EyeCalibration.restore(saved)
        with self.assertRaises(ValueError):
            fixture((False, False))

    def test_pose_gate_rejects_incompatible_anchor_and_degenerate_faces(self):
        points = np.array([[100, 100], [200, 100], [150, 150], [110, 200], [190, 200]], np.float32)
        self.assertTrue(matching_pose(points, points * 2 + 12))
        other = points.copy(); other[2, 0] += 60
        self.assertFalse(matching_pose(points, other))
        with self.assertRaises(ValueError):
            matching_pose(np.zeros((5, 2)), points)


class ExactAnchorRecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.folder = Path(cls.directory.name)
        (cls.folder / 'result').mkdir()
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=24',
                        '-frames:v', '5', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(cls.folder / 'source.mp4')], check=True)
        cv2.imwrite(str(cls.folder / 'reference.png'), np.zeros((64, 64, 3), np.uint8))
        helper = types.ModuleType('facefusion.face_helper')
        helper.warp_face_by_face_landmark_5 = lambda *args: (_ for _ in ()).throw(AssertionError('Skipped/restored anchors do not recrop or infer'))
        cls.fake_modules = {'facefusion': types.ModuleType('facefusion'), 'facefusion.face_helper': helper}
        cls.request = {'jobId': 'test', 'version': 'source-face-v4', 'profileSHA256': '1' * 64, 'profile': 'perform-onnx60', 'anchorFrame': 3}
        cls.inputs = {'sourceSHA256': '2' * 64, 'referenceSHA256': '3' * 64}
        cls.info = {'width': 64, 'height': 64, 'frames': 5}

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    def setUp(self):
        (self.folder / 'result/calibration.json').unlink(missing_ok=True)

    def call(self, request=None, inputs=None, face=None):
        with patch.dict(sys.modules, self.fake_modules), patch.object(facial_worker, 'face', face or (lambda image: None)):
            return facial_worker.eye_calibration(self.folder, object(), object(), request or self.request, inputs or self.inputs, self.info)

    def test_later_anchor_is_exact_and_skips_uncertain_face_explicitly(self):
        _, meta = self.call()
        capture = cv2.VideoCapture(str(self.folder / 'source.mp4'))
        hashes = []
        for _ in range(4):
            ok, frame = capture.read(); self.assertTrue(ok)
            hashes.append(hashlib.sha256(frame.tobytes()).hexdigest())
        capture.release()
        self.assertEqual(meta['anchorBGRSHA256'], hashes[3])
        self.assertNotEqual(hashes[0], hashes[3])
        self.assertEqual(meta['anchorFrame'], 3)
        self.assertEqual(meta['state'], 'skipped')
        self.assertEqual(meta['reason'], 'anchor-face-uncertain')
        _, second = self.call(face=lambda image: (_ for _ in ()).throw(AssertionError('Frozen calibration must be reused')))
        self.assertEqual(meta, second)

    def test_saved_source_or_anchor_change_never_selects_a_different_frame(self):
        self.call()
        for inputs, request in [({**self.inputs, 'sourceSHA256': '4' * 64}, self.request),
                                (self.inputs, {**self.request, 'anchorFrame': 2})]:
            with self.assertRaisesRegex(ValueError, 'changed'):
                self.call(request=request, inputs=inputs)

    def test_active_anchor_reuses_the_frozen_calibration_without_models(self):
        _, meta = self.call()
        file = self.folder / 'result/calibration.json'
        saved = json.loads(file.read_text())
        model, _, _ = fixture()
        saved['model'] = model.freeze()
        saved['metadata'].update(state='active', reason=None, **model.describe())
        file.write_text(json.dumps(saved))
        _, active = self.call(face=lambda image: (_ for _ in ()).throw(AssertionError('Resume must not infer a new anchor')))
        self.assertEqual(active['state'], 'active')
        self.assertEqual(active['anchorBGRSHA256'], meta['anchorBGRSHA256'])

    def test_invalid_anchor_fails_without_loading_any_face_models(self):
        for index in [-1, 5, True, None, 1.5]:
            with self.subTest(index=index), self.assertRaisesRegex(ValueError, 'anchor'):
                self.call(request={**self.request, 'anchorFrame': index})


if __name__ == '__main__':
    unittest.main()
