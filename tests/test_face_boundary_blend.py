"""Boundary treatment must not trade source performance for softer edges."""
import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from face_boundary_blend import boundary_plane, composite
from face_feature_cleanup import absolute_composite


class BoundaryBlendTests(unittest.TestCase):
    def setUp(self):
        self.raw = np.full((512, 512, 3), 90, np.uint8)
        self.edited = np.full((512, 512, 3), 130, np.uint8)
        self.alpha = np.zeros((512, 512), np.float32)
        self.alpha[80:435, 95:416] = 1
        self.labels = np.zeros((512, 512), np.uint8)
        self.labels[80:435, 95:416] = 1
        self.labels[120:145, 97:180] = 4
        self.labels[320:350, 230:285] = 12

    def blend(self, **overrides):
        args = dict(raw=self.raw, edited=self.edited, alpha=self.alpha,
                    labels=self.labels, scale=1.)
        args.update(overrides)
        return boundary_plane(**args)

    def test_permission_only_fades_inward_and_cannot_repaint_protected_regions(self):
        self.alpha[180:220, 200:250] = 0  # An occluder inside the face.
        result, alpha, detail = self.blend()
        self.assertTrue(np.all(alpha <= self.alpha))
        np.testing.assert_array_equal(alpha[self.alpha == 0], 0)
        np.testing.assert_array_equal(result[self.alpha == 0], self.edited[self.alpha == 0])
        self.assertLess(alpha[200, 95], self.alpha[200, 95])
        self.assertFalse(detail['outwardGrowth'])
        self.assertFalse(detail['sourceRGBTransferred'])

    def test_complete_performance_features_and_new_chin_retain_ownership(self):
        support = np.zeros((512, 512), bool)
        support[425:435, 200:310] = True
        result, alpha, _ = self.blend(jaw_support=support)
        features = np.isin(self.labels, [2, 3, 4, 5, 10, 11, 12, 13]) | support
        np.testing.assert_array_equal(alpha[features], self.alpha[features])
        np.testing.assert_array_equal(result[features], self.edited[features])

    def test_lighting_change_is_bounded_and_centre_is_unchanged(self):
        result, alpha, _ = self.blend(strength=1.)
        self.assertLessEqual(float(np.abs(result-self.edited).max()), 16.)
        np.testing.assert_array_equal(result[200:280, 230:285], self.edited[200:280, 230:285])
        self.assertEqual(float(alpha[200, 256]), 1.)

    def test_zero_strength_is_exactly_the_frozen_scene_compositor(self):
        frame = np.full((600, 600, 3), 72, np.uint8)
        matrix = np.array([[1., 0, -30.25], [0, 1., -20.75]])
        skin = np.zeros_like(self.alpha)
        expected, permission = absolute_composite(frame, self.raw, self.edited, matrix, self.alpha, skin)
        actual, actual_permission, _ = composite(frame, self.raw, self.edited, matrix,
                                                self.alpha, skin, self.labels, strength=0)
        np.testing.assert_array_equal(actual, expected)
        np.testing.assert_array_equal(actual_permission, permission)

    def test_subpixel_projection_keeps_all_zero_permission_scene_pixels_exact(self):
        rng = np.random.default_rng(17)
        frame = rng.integers(0, 256, (600, 600, 3), dtype=np.uint8)
        self.alpha[210:240, 230:260] = 0
        matrix = np.array([[.8, -.1, 7.25], [.1, .8, -20.75]])
        actual, permission, _ = composite(frame, self.raw, self.edited, matrix,
                                         self.alpha, np.zeros_like(self.alpha), self.labels)
        np.testing.assert_array_equal(actual[permission == 0], frame[permission == 0])

    def test_empty_permission_is_identity_and_never_claims_pixels(self):
        result, alpha, detail = self.blend(alpha=np.zeros_like(self.alpha))
        np.testing.assert_array_equal(result, self.edited)
        self.assertEqual(float(alpha.sum()), 0.)
        self.assertEqual(detail['boundaryPixels'], 0)

    def test_invalid_masks_geometry_and_image_values_are_rejected(self):
        for change in [dict(scale=np.nan), dict(scale=0), dict(strength=np.nan), dict(strength=-1),
                       dict(alpha=np.full_like(self.alpha, np.nan)),
                       dict(labels=self.labels.astype(np.float32)),
                       dict(labels=np.full_like(self.labels, 19)),
                       dict(edited=np.full(self.edited.shape, np.nan)),
                       dict(jaw_support=np.zeros_like(self.alpha))]:
            with self.subTest(change=list(change)), self.assertRaises(ValueError):
                self.blend(**change)


if __name__ == '__main__':
    unittest.main()
