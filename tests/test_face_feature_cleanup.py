"""Regression cases for incomplete feature ownership and occluder protection."""
import sys
from pathlib import Path
import unittest

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from face_feature_cleanup import absolute_composite, eye_areas, feature_masks, restore_eye_detail, source_eye_gates


class FaceFeatureCleanupTests(unittest.TestCase):
    def setUp(self):
        self.labels = np.zeros((512, 512), np.uint8)
        self.labels[70:450, 70:450] = 1
        self.labels[150:175, 160:210] = 2
        self.labels[195:225, 160:210] = 4
        self.occ = (self.labels == 1).astype(np.float32)

    def test_visible_eye_and_brow_override_only_their_false_occlusion_holes(self):
        edited = self.labels.copy()
        edited[195:225, 160:210] = 1
        edited[219:229, 160:210] = 4
        alpha, _ = feature_masks(self.labels, edited, self.occ, 1)
        self.assertEqual(alpha[205, 185], 1)
        self.assertEqual(alpha[160, 185], 1)
        self.assertEqual(alpha[0, 0], 0)

    def test_edited_features_cannot_grant_permission_over_hair_glasses_or_foreground(self):
        edited = self.labels.copy()
        for value, x in [(17, 155), (6, 205), (0, 255)]:
            self.labels[190:230, x:x + 20] = value
            self.occ[190:230, x:x + 20] = 0
            edited[190:230, x:x + 20] = 4
        alpha, _ = feature_masks(self.labels, edited, self.occ, 1)
        for x in [155, 205, 255]:
            self.assertFalse(alpha[190:230, x:x + 20].any())

    def test_real_occluder_inside_skin_is_not_filled_by_nearby_features(self):
        self.occ[300:325, 180:205] = 0
        alpha, _ = feature_masks(self.labels, self.labels, self.occ, 1)
        self.assertFalse(alpha[300:325, 180:205].any())

    def test_absolute_ownership_removes_old_displaced_feature_instead_of_adding_edges(self):
        raw = np.full((512, 512, 3), 140, np.uint8)
        raw[195:220, 160:210] = 10
        edited = np.full_like(raw, 140)
        edited[220:230, 160:210] = 20
        alpha, skin = feature_masks(self.labels, self.labels, self.occ, 1)
        result, projected = absolute_composite(raw, raw, edited, np.array([[1., 0., 0.], [0., 1., 0.]]), alpha, skin)
        self.assertGreater(result[205, 185, 0], 130)
        np.testing.assert_array_equal(result[projected == 0], raw[projected == 0])

    def test_closed_source_eyes_never_reopen_from_raw_texture(self):
        raw = np.full((512, 512, 3), 220, np.uint8)
        edited = np.full_like(raw, 90)
        result, stats = restore_eye_detail(raw, edited, self.labels, np.ones_like(self.occ), [0, 0])
        np.testing.assert_array_equal(result, edited)
        self.assertEqual(stats['eyeTexturePixels'], 0)

    def test_open_eye_texture_cannot_change_other_eye_or_occluded_pixels(self):
        labels = self.labels.copy()
        labels[195:225, 300:350] = 5
        raw = np.full((512, 512, 3), 220, np.uint8)
        edited = np.full_like(raw, 90)
        occ = np.ones_like(self.occ)
        occ[200:210, 175:185] = 0
        result, stats = restore_eye_detail(raw, edited, labels, occ, [1, 0])
        self.assertGreater(stats['eyeTexturePixels'], 0)
        np.testing.assert_array_equal(result[200:210, 175:185], edited[200:210, 175:185])
        np.testing.assert_array_equal(result[:, 256:], edited[:, 256:])
        np.testing.assert_array_equal(result[labels != 4], edited[labels != 4])

    def test_subpixel_projection_cannot_leak_permission_into_classified_occluders(self):
        raw = np.full((512, 512, 3), 80, np.uint8)
        corrected = np.full_like(raw, 160)
        alpha = np.zeros_like(self.occ)
        alpha[100:200, 100:200] = 1
        matrix = np.array([[1, 0, .4], [0, 1, .4]], np.float32)
        result, permission = absolute_composite(raw, raw, corrected, matrix, alpha, np.zeros_like(alpha))
        support = cv2.warpAffine(alpha, cv2.invertAffineTransform(matrix), (512, 512), flags=cv2.INTER_NEAREST)
        self.assertFalse(permission[support == 0].any())
        np.testing.assert_array_equal(result[support == 0], raw[support == 0])

    def test_semantic_eye_names_do_not_swap_image_halves(self):
        labels = np.zeros_like(self.labels)
        labels[10:20, 20:30] = 5
        labels[20:25, 40:45] = 4
        labels[10:13, 300:310] = 4
        np.testing.assert_array_equal(eye_areas(labels), [125, 30])

    def test_source_eye_permission_needs_visible_area_and_real_opening(self):
        points = np.zeros((68, 2), np.float32)
        eye = np.array([[0, 0], [10, -5], [20, -5], [30, 0], [20, 5], [10, 5]], np.float32)
        points[36:42] = eye + [170, 210]
        points[42:48] = eye + [300, 210]
        labels = self.labels.copy()
        labels[195:225, 300:350] = 5
        self.assertEqual(source_eye_gates(labels, points), [1, 1])
        points[42:48, 1] = 210
        self.assertEqual(source_eye_gates(labels, points), [1, 0])
        labels[195:225, 160:210] = 1
        self.assertEqual(source_eye_gates(labels, points), [0, 0])

    def test_rejects_nonfinite_or_singular_geometry_and_invalid_masks(self):
        image = np.full((512, 512, 3), 100, np.uint8)
        for matrix in [np.zeros((2, 3)), np.full((2, 3), np.nan)]:
            with self.assertRaises(ValueError):
                absolute_composite(image, image, image, matrix, self.occ, self.occ)
        with self.assertRaises(ValueError):
            feature_masks(self.labels, self.labels, self.occ * 2, 1)
        with self.assertRaises(ValueError):
            restore_eye_detail(image, image, self.labels, self.occ, [np.nan, 0])


if __name__ == '__main__':
    unittest.main()
