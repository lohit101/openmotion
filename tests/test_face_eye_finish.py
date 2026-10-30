"""Protection, timing and immutable native-input checks for optional eye finishing."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from face_eye_placement import retarget
from face_eye_temporal import temporal_source
from face_eye_finish import frozen_native
from facial_runtime import profile_hash


class EyeFinishTests(unittest.TestCase):
    def temporal(self, values, gates=(1, 1, 1)):
        records = [{'action': 'source-eye-plane-flow', 'modes': {'test': {'eyes': [
            {'side': side, 'sourceUV': [.5+value, 0], 'targetUV': [.5, 0], 'sourceOpenGate': gate} for side in range(2)]}}}
            for value, gate in zip(values, gates)]
        before = copy.deepcopy(records)
        source = [{'uv': np.array([.5+values[1], 0], np.float32)} for _ in range(2)]
        original = [eye['uv'].copy() for eye in source]
        target = [{'uv': np.array([.5, 0], np.float32)} for _ in range(2)]
        out, proof = temporal_source(source, target, records, 1, 'test')
        self.assertEqual(records, before)
        for a, b in zip(original, source):
            np.testing.assert_array_equal(a, b['uv'])
        return out[0]['uv'][0]-.5, proof

    def test_isolated_coordinate_error_is_suppressed(self):
        self.assertAlmostEqual(float(self.temporal([.02, .11, .025])[0]), .025, places=6)

    def test_monotonic_fast_motion_keeps_current_frame_timing(self):
        for values, expected in [([0, .1, .1], .1), ([-.1, 0, .1], 0)]:
            self.assertAlmostEqual(float(self.temporal(values)[0]), expected, places=6)

    def test_temporal_reuse_never_crosses_a_blink(self):
        delta, proof = self.temporal([.02, .11, .025], (0, 1, 1))
        self.assertAlmostEqual(float(delta), .11, places=6)
        self.assertEqual(proof['eyes'][0]['window'], [1])

    def test_ambiguous_current_eye_never_invents_pixels(self):
        image = np.random.default_rng(7).integers(0, 256, (512, 512, 3), dtype=np.uint8)
        result, permission, status = retarget(image, None, None, [1, 1])
        np.testing.assert_array_equal(result, image)
        self.assertFalse(permission.any())
        self.assertEqual(status['state'], 'skipped')

    def test_open_eye_warp_preserves_every_pixel_outside_eye_interiors(self):
        image = np.full((512, 512, 3), 180, np.uint8)
        source, target = [], []
        for x in [160, 340]:
            cv2.circle(image, (x, 220), 10, (25, 40, 60), -1)
            eye = {'a': np.array([x-45, 220], np.float32), 'b': np.array([x+45, 220], np.float32),
                   'h': np.array([1, 0], np.float32), 'v': np.array([0, 1], np.float32), 'width': 90.,
                   'pupil': np.array([x, 220], np.float32), 'radius': 10., 'uv': np.array([.5, 0], np.float32),
                   'contour': np.array([[x-45, 220], [x-30, 202], [x+30, 202], [x+45, 220], [x+30, 238], [x-30, 238]], np.float32)}
            target.append(eye)
            moved = copy.deepcopy(eye); moved['uv'][0] = .6; source.append(moved)
        out, permission, status = retarget(image, source, target, [1, 1])
        np.testing.assert_array_equal(out[permission == 0], image[permission == 0])
        self.assertTrue(np.any(out != image))
        for eye in status['eyes']:
            self.assertGreaterEqual(eye['minInverseJacobian'], .1)
            self.assertGreater(eye['deltaPixels'][0], 0)
        shut, mask, _ = retarget(image, source, target, [0, 0])
        np.testing.assert_array_equal(shut, image); self.assertFalse(mask.any())

    def test_native_checkpoint_is_reused_and_tampering_never_recomputes_it(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory); result = folder/'result'; result.mkdir()
            request = {'version': 'source-face-v5', 'profileSHA256': profile_hash('source-face-v5')}
            inputs = {'request': request}
            (folder/'request.json').write_text(json.dumps(request)); (folder/'inputs.json').write_text(json.dumps(inputs))
            frame = result/'frame-000000.png'; frame.write_bytes(b'immutable native pixels')
            final = result/'final.mp4'; final.write_bytes(b'immutable native video')
            digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
            receipt = {'complete': True, 'inputs': {**inputs, 'version': 'source-face-v5'}, 'records': [{'frame': 0, 'sha256': digest(frame)}], 'outputSHA256': digest(final)}
            native = Mock(return_value=receipt)
            frozen_native(folder, native); native.assert_called_once_with(folder)
            replacement = result/'final.part.mp4'; replacement.write_bytes(b'finished eye result'); replacement.replace(final)
            self.assertEqual((result/'native-final.mp4').read_bytes(), b'immutable native video')
            native.reset_mock(); frozen_native(folder, native); native.assert_not_called()
            frame.write_bytes(b'tampered pixels')
            with self.assertRaisesRegex(ValueError, 'native facial frame changed'):
                frozen_native(folder, native)
            native.assert_not_called(); self.assertEqual(frame.read_bytes(), b'tampered pixels')


if __name__ == '__main__':
    unittest.main()
