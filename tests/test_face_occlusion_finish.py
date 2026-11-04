"""Frame-stage tests use arrays and stub predictions, never model inference."""
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import face_occlusion_finish as finish


class FrameStage(unittest.TestCase):
    def setUp(self):
        self.raw = np.full((24, 20, 3), 70, np.uint8)
        self.edited = np.full_like(self.raw, 130)
        self.hard = np.zeros(self.raw.shape[:2], bool)
        self.hard[:, 8:12] = True
        self.veto = np.ones(self.raw.shape[:2], np.float32)
        self.veto[self.hard] = 0
        self.observation = {'targetMaskState': 'segmented', 'sourceMaskState': 'segmented',
            'targetHard': self.hard, 'targetVeto': self.veto, 'cacheSHA256': 'a' * 64,
            'trackValid': False, 'source203': None, 'sourceHandMask': None,
            'sourceAffine': np.array([[1., 0., 0.], [0., 1., 0.]])}

    def run_frame(self, record, source_face=None, target_face=None, **kwargs):
        return finish.finish_frame(None, None, self.raw, self.raw, target_face, source_face,
            self.observation, self.edited.copy(), record, kwargs.get('calibration', False))

    def test_primary_last_veto_preserves_raw_hand(self):
        out, record = self.run_frame({'action': 'refined'}, source_face=object())
        np.testing.assert_array_equal(out[self.hard], self.raw[self.hard])
        np.testing.assert_array_equal(out[~self.hard], self.edited[~self.hard])
        self.assertEqual(record['occlusion']['route'], 'primary')
        self.assertTrue(record['occlusion']['targetProtectedPixelsExact'])

    def test_unknown_target_preserves_all_raw_without_prediction(self):
        self.observation.update(targetMaskState='unavailable', targetVeto=np.zeros_like(self.veto),
                                targetHard=np.ones_like(self.hard))
        out, record = self.run_frame({'action': 'refined'}, source_face=object())
        np.testing.assert_array_equal(out, self.raw)
        self.assertEqual(record['action'], 'preserved')
        self.assertEqual(record['reason'], 'target-foreground-unavailable')

    def test_invalid_source_track_does_not_invoke_generator(self):
        target = (None, np.zeros((5, 2)), np.zeros((68, 2)))
        out, record = self.run_frame({'action': 'preserved'}, target_face=target, calibration=True)
        self.assertEqual(record['partialEyeAdmission']['reason'], 'source-track-unavailable')
        self.assertEqual(record['occlusion']['route'], 'preserved')

    def test_partial_orbital_veto_is_not_applied_twice(self):
        # A fractional edge would darken twice if the primary final-veto path
        # accidentally ran after the orbital compositor had already used it.
        self.observation['trackValid'] = True
        target = (None, np.zeros((5, 2)), np.zeros((68, 2)))
        helper, masker = ModuleType('facefusion.face_helper'), ModuleType('facefusion.face_masker')
        helper.warp_face_by_face_landmark_5 = lambda *args: (np.zeros((512, 512, 3), np.uint8), self.observation['sourceAffine'])
        masker.create_occlusion_mask = lambda *args: np.ones((512, 512), np.float32)
        expected = self.raw.copy(); expected[0, 0] = 91
        detail = {'edited': True}
        predictor = SimpleNamespace(correct=lambda *args: np.zeros((512, 512, 3), np.uint8), last={})
        with patch.dict(sys.modules, {'facefusion.face_helper': helper, 'facefusion.face_masker': masker}), \
             patch.object(finish, 'admit_visible_eye', return_value={'admitted': True, 'selectedImageEye': 'image-left'}), \
             patch.object(finish, 'compose_orbital', return_value=(expected, detail, np.ones_like(self.veto))), \
             patch.object(finish, 'apply_scene_veto', side_effect=AssertionError('double veto')):
            out, record = finish.finish_frame(predictor, lambda image: np.zeros((512, 512), np.uint8),
                self.raw, self.raw, target, None, self.observation, self.raw.copy(), {'action': 'preserved'}, True)
        np.testing.assert_array_equal(out, expected)
        self.assertEqual(record['action'], 'partial-eye')
        self.assertEqual(record['occlusion']['route'], 'partial-eye')


if __name__ == '__main__':
    unittest.main()
