"""Synthetic array ownership/provenance checks; no models or private fixtures."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import face_partial_source as partial

cv2.setNumThreads(2)
SOURCE = 'a' * 64
IDENTITY = np.array([[1., 0., 0.], [0., 1., 0.]])
SCOPE = dict(source_sha=SOURCE, track_id='tracked-person', shot_id='shot-A', frame_count=120)


def ellipse_points(x, y, rx, ry, n):
    angles = np.arange(n) * 2 * np.pi / n
    return np.stack([x + rx * np.cos(angles), y + ry * np.sin(angles)], axis=1).astype(np.float32)


def source_geometry():
    points = np.full((203, 2), 256., np.float32)
    points[:24] = ellipse_points(170, 180, 20, 6, 24)
    points[24:48] = ellipse_points(342, 180, 20, 6, 24)
    points[48:108] = ellipse_points(256, 315, 35, 12, 60)
    return points


def compositor_inputs():
    scene = np.full((512, 512, 3), 80, np.uint8)
    raw = scene.copy()
    predicted = np.full_like(raw, 120)
    labels = np.ones((512, 512), np.uint8)
    labels[175:186, 150:191] = 4
    labels[175:186, 322:363] = 5
    # Deliberately put excluded semantic labels inside swept orbital support.
    labels[164:170, 151:188] = 2
    labels[188:193, 162:177] = 12
    labels[301:321, 225:286] = 11
    predicted_labels = labels.copy()
    predicted_labels[171:174, 179:192] = 3
    target68 = np.full((68, 2), 256., np.float32)
    target68[36:42] = ellipse_points(170, 180, 20, 6, 6)
    target68[42:48] = ellipse_points(342, 180, 20, 6, 6)
    xseg = np.ones((512, 512), np.float32)
    xseg[176:185, 165:175] = 0
    hand = np.zeros((512, 512), bool)
    hand[175:190, 145:160] = True
    veto, hard = partial.foreground_veto(hand)
    return [scene, raw, predicted, labels, predicted_labels, xseg, IDENTITY.copy(), target68, veto], hard


class ClearAnchorTests(unittest.TestCase):
    def candidate(self, frame, **extra):
        return dict(frame=frame, sourceSHA256=SOURCE, trackId=SCOPE['track_id'], shotId=SCOPE['shot_id'],
                    primaryValid=True, clear=True, ambiguous=False, **extra)

    def test_nearest_real_observation_and_deterministic_tie(self):
        before, after = self.candidate(8), self.candidate(15)
        got = partial.choose_clear_anchor([after, before], missing_span=[10, 14], **SCOPE)
        self.assertEqual(got, before)
        self.assertIsNot(got, before)
        self.assertEqual(partial.choose_clear_anchor([before, self.candidate(14)], missing_span=[10, 14], **SCOPE)['frame'], 14)

    def test_rejects_other_identity_track_shot_and_ambiguous_candidates(self):
        candidates = []
        for key, value in [('sourceSHA256', 'b' * 64), ('trackId', 'other'), ('shotId', 'shot-B'),
                           ('primaryValid', False), ('clear', False), ('ambiguous', True), ('frame', 120)]:
            row = self.candidate(9); row[key] = value; candidates.append(row)
        self.assertIsNone(partial.choose_clear_anchor(candidates, missing_span=[10, 14], **SCOPE))
        with self.assertRaises(ValueError):
            partial.choose_clear_anchor([], missing_span=[14, 10], **SCOPE)

    def test_freezes_one_alignment_and_checks_resume_provenance(self):
        arc = np.array([[1.5, 0., 20.], [0., 1.5, -4.]])
        dense = np.array([[2., 0., 7.], [0., 2., 9.]])
        binding = partial.freeze_alignment(arc, dense, anchor_frame=14, **SCOPE)
        self.assertEqual(partial.freeze_alignment(arc, dense, anchor_frame=14, existing=binding, **SCOPE), binding)
        np.testing.assert_allclose(partial.tracked_arc5(dense, binding, **SCOPE), arc, atol=1e-12)
        moved = dense.copy(); moved[:, 2] += [2., 4.]
        expected = np.asarray(binding['cross']) @ np.vstack([moved, [0., 0., 1.]])
        np.testing.assert_allclose(partial.tracked_arc5(moved, binding, **SCOPE), expected[:2], atol=1e-12)
        for key, value in [('source_sha', 'b' * 64), ('track_id', 'another-track'), ('shot_id', 'another-shot'), ('frame_count', 119)]:
            scope = {**SCOPE, key: value}
            with self.subTest(key=key), self.assertRaises(ValueError):
                partial.tracked_arc5(dense, binding, **scope)
        with self.assertRaises(ValueError):
            partial.freeze_alignment(arc, dense, anchor_frame=15, existing=binding, **SCOPE)

    def test_rejects_tampered_binding_even_with_recomputed_outer_hash(self):
        binding = partial.freeze_alignment(IDENTITY, IDENTITY, anchor_frame=14, **SCOPE)
        for rehash in [False, True]:
            bad = copy.deepcopy(binding); bad['cross'][0][2] += 1
            if rehash:
                bad['sha256'] = hashlib.sha256(json.dumps({k: v for k, v in bad.items() if k != 'sha256'},
                                                         sort_keys=True, separators=(',', ':')).encode()).hexdigest()
            with self.subTest(rehash=rehash), self.assertRaises(ValueError):
                partial.tracked_arc5(IDENTITY, bad, **SCOPE)
        for bad in [np.array([[1., .2, 0.], [0., 1., 0.]]), np.array([[-1., 0., 0.], [0., 1., 0.]])]:
            with self.assertRaises(ValueError):
                partial.freeze_alignment(bad, IDENTITY, anchor_frame=14, **SCOPE)


class EyeAdmissionTests(unittest.TestCase):
    def test_dynamic_sides_and_group_order_follow_observed_geometry(self):
        points = source_geometry(); hand = np.zeros((512, 512), bool); hand[150:215, 300:385] = True
        left = partial.admit_visible_eye(points, hand, IDENTITY, False, True)
        self.assertTrue(left['admitted']); self.assertEqual(left['selectedImageEye'], 'image-left')
        swapped = points.copy(); swapped[:24], swapped[24:48] = points[24:48], points[:24]
        self.assertEqual(partial.admit_visible_eye(swapped, hand, IDENTITY, False, True)['selectedImageEye'], 'image-left')
        mirrored = points.copy(); mirrored[:, 0] = 511 - mirrored[:, 0]
        right = partial.admit_visible_eye(mirrored, hand[:, ::-1], IDENTITY, False, True)
        self.assertTrue(right['admitted']); self.assertEqual(right['selectedImageEye'], 'image-right')
        self.assertTrue(right['sourceToTargetImageSideCorrespondenceAssumed'])
        self.assertFalse(right['independentFullSourceFacePoseGateAvailable'])

    def test_no_manual_or_hidden_eye_admission_for_uncertain_cases(self):
        points = source_geometry(); empty = np.zeros((512, 512), bool)
        mouth = empty.copy(); mouth[285:345, 210:300] = True
        both = empty.copy(); both[150:215, 140:385] = True
        cases = [
            (empty, {}, 'no-source-facial-hand-overlap'),
            (mouth, {}, 'ambiguous-multiple-clear-eyes'),
            (both, {}, 'no-clear-in-frame-eye'),
            (None, {}, 'source-hand-mask-unavailable'),
            (mouth, {'source_mask_state': 'unavailable'}, 'source-hand-mask-unavailable'),
            (mouth, {'track_valid': False}, 'source-track-unavailable'),
        ]
        for mask, extra, reason in cases:
            result = partial.admit_visible_eye(points, mask, IDENTITY, False, True, **extra)
            self.assertFalse(result['admitted']); self.assertEqual(result['reason'], reason)
            self.assertFalse(result['manualLabelsUsed'])
        self.assertEqual(partial.admit_visible_eye(points, mouth, IDENTITY, True, True)['reason'], 'primary-source-route-retained')
        self.assertEqual(partial.admit_visible_eye(points, mouth, IDENTITY, False, False)['reason'], 'target-primary-unavailable')
        right_covered = empty.copy(); right_covered[150:215, 300:385] = True
        outside = points.copy(); outside[:24, 0] -= 200
        self.assertFalse(partial.admit_visible_eye(outside, right_covered, IDENTITY, False, True)['admitted'])
        nonfinite = points.copy(); nonfinite[0, 0] = np.nan
        self.assertFalse(partial.admit_visible_eye(nonfinite, right_covered, IDENTITY, False, True)['admitted'])


class RegionalOwnershipTests(unittest.TestCase):
    def test_full_old_feature_ownership_respects_hands_brows_mouth_xseg_and_other_eye(self):
        args, hard = compositor_inputs()
        scene, _, _, raw_labels, predicted_labels, xseg, *_ = args
        output, detail, permission = partial.compose_orbital(*args, 'image-left')
        self.assertGreater(detail['changedPixels'], 0)
        self.assertTrue(detail['targetVetoZeroExact'])
        excluded = np.isin(raw_labels, [2, 3, 11, 12, 13]) | np.isin(predicted_labels, [2, 3, 11, 12, 13])
        protected = hard | excluded | (xseg == 0)
        np.testing.assert_array_equal(output[protected], scene[protected])
        np.testing.assert_array_equal(output[:, 256:], scene[:, 256:])
        np.testing.assert_array_equal(output[permission == 0], scene[permission == 0])
        self.assertFalse(detail['sourceRGBTransferred']); self.assertFalse(detail['qualityClaimed'])

    def test_mirrored_ownership_math_not_neural_equivariance(self):
        args, _ = compositor_inputs()
        left, _, left_permission = partial.compose_orbital(*args, 'image-left')
        mirror = [a[:, ::-1].copy() if i in [0, 1, 2, 3, 4, 5, 8] else a.copy() for i, a in enumerate(args)]
        mirror[7][:, 0] = 511 - mirror[7][:, 0]
        right, _, right_permission = partial.compose_orbital(*mirror, 'image-right')
        np.testing.assert_array_equal(right, left[:, ::-1])
        np.testing.assert_allclose(right_permission, left_permission[:, ::-1], atol=1e-6)
        unchanged, detail, permission = partial.compose_orbital(*args, None)
        np.testing.assert_array_equal(unchanged, args[0]); self.assertFalse(detail['edited'])
        self.assertFalse(permission.any())

    def test_final_scene_veto_fails_closed_for_missing_ownership(self):
        args, _ = compositor_inputs(); scene = args[0]; generated = np.full_like(scene, 220)
        mask = np.zeros(scene.shape[:2], bool); mask[100:300, 200:230] = True
        veto, hard = partial.foreground_veto(mask)
        output = partial.apply_scene_veto(scene, generated, veto)
        np.testing.assert_array_equal(output[hard], scene[hard])
        self.assertTrue(np.any(output[~hard] != scene[~hard]))
        unknown, all_hard = partial.foreground_veto(None, shape=scene.shape[:2], state='unavailable')
        self.assertTrue(all_hard.all()); self.assertFalse(unknown.any())
        np.testing.assert_array_equal(partial.apply_scene_veto(scene, generated, unknown), scene)
        none, _ = partial.foreground_veto(None, shape=scene.shape[:2], state='known-none')
        np.testing.assert_array_equal(partial.apply_scene_veto(scene, generated, none), generated)
        with self.assertRaises(ValueError):
            partial.foreground_veto(mask, state='known-none')


if __name__ == '__main__':
    unittest.main()
