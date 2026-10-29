import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from face_performance import FaceModels, compose_expression, composite_face


class FacePerformanceTests(unittest.TestCase):
    def test_regional_transfer_preserves_structural_and_depth_channels_without_mutating_inputs(self):
        rng = np.random.default_rng(21)
        target = rng.normal(size=(1, 49, 3)).astype(np.float32)
        source = rng.normal(size=(1, 49, 3)).astype(np.float32)
        original_target, original_source = target.copy(), source.copy()
        result = compose_expression(target, source, True)
        self.assertTrue(np.array_equal(result[:, :, 2], target[:, :, 2]))
        self.assertTrue(np.array_equal(result[:, [8, 9, 10, 11, 12, 13, 14, 20, 26, 39, 40, 41, 42, 43]], target[:, [8, 9, 10, 11, 12, 13, 14, 20, 26, 39, 40, 41, 42, 43]]))
        self.assertFalse(np.array_equal(result[:, :8, :2], target[:, :8, :2]))
        self.assertTrue(np.array_equal(target, original_target))
        self.assertTrue(np.array_equal(source, original_source))

    def test_standard_transfer_retains_target_jaw_width_and_depth(self):
        target = np.full((1, 49, 3), .01, np.float32)
        source = np.full((1, 49, 3), .06, np.float32)
        result = compose_expression(target, source, False)
        self.assertTrue(np.array_equal(result[:, [44, 45, 46], 0], target[:, [44, 45, 46], 0]))
        self.assertTrue(np.array_equal(result[:, [44, 45, 46], 2], target[:, [44, 45, 46], 2]))
        self.assertTrue(np.array_equal(result[:, :8], source[:, :8]))

    def test_protected_scene_and_occlusion_holes_are_exact_before_encoding(self):
        frame = np.full((80, 100, 3), 63, np.uint8)
        crop = np.full((80, 100, 3), 210, np.uint8)
        mask = np.zeros((80, 100), np.float32)
        mask[10:70, 20:80] = 1
        mask[25:45, 35:65] = 0  # a foreground hand must remain untouched
        result = composite_face(frame, crop, np.array([[1, 0, 0], [0, 1, 0]], np.float32), mask)
        self.assertTrue(np.array_equal(result[mask == 0], frame[mask == 0]))
        self.assertTrue(np.all(result[mask == 1] == 210))

    def test_sixty_percent_is_an_output_blend_not_an_embedding_change(self):
        model = object.__new__(FaceModels)
        expression = np.full((512, 512, 3), 90, np.uint8)
        model.expression = lambda *args: expression
        model.identity = lambda *args: np.full((512, 512, 3), 210, np.uint8)
        result = model.correct(expression, expression, np.ones((512, 512)), False)
        self.assertTrue(np.all(result == 162))


if __name__ == '__main__':
    unittest.main()
