import sys
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from face_feature_cleanup import absolute_composite, feature_masks
from face_jaw_geometry import jaw_masks


class JawGeometryTests(unittest.TestCase):
    def setUp(self):
        self.raw = np.zeros((512, 512), np.uint8)
        self.raw[330:500, 140:372] = 14
        cv2.ellipse(self.raw, (256, 245), (140, 175), 0, 0, 360, 1, -1)
        cv2.ellipse(self.raw, (256, 340), (40, 18), 0, 0, 360, 12, -1)
        self.edited = self.raw.copy()
        cv2.ellipse(self.edited, (256, 260), (140, 182), 0, 0, 360, 1, -1)
        cv2.ellipse(self.edited, (256, 352), (40, 25), 0, 0, 360, 12, -1)
        self.source = np.ones((512, 512), np.uint8)
        self.occ = np.ones((512, 512), np.float32)
        self.points = np.full((68, 2), 256, np.float32)
        self.points[4:13] = [(160,340),(174,372),(190,400),(215,420),(256,432),
                             (297,420),(322,400),(338,372),(352,340)]
        self.points[[54,57,48]] = [(305,335),(256,370),(207,335)]

    def run_mask(self, **overrides):
        values = dict(raw_labels=self.raw, edited_labels=self.edited, occlusion=self.occ,
                      source_labels=self.source, source_occlusion=self.occ,
                      source_points=self.points, scale=1.)
        values.update(overrides)
        return jaw_masks(**values)

    def test_speaking_chin_is_owned_and_old_lighting_statistics_stay_exact(self):
        old, old_skin = feature_masks(self.raw, self.edited, self.occ, 1.)
        alpha, skin, detail = self.run_mask()
        self.assertIsNone(detail['reason'])
        self.assertGreater(detail['extensionPixels'], 0)
        self.assertLess(old[430,256], .01)
        self.assertGreater(alpha[430,256], .99)
        np.testing.assert_array_equal(old_skin, skin)
        self.assertTrue(np.all(alpha >= old))

    def test_hair_clothes_glasses_background_are_never_claimed(self):
        raw = self.raw.copy()
        for x, value in [(245,17),(250,16),(255,6),(260,0)]:
            raw[420:460,x:x+3] = value
        alpha, _, _ = self.run_mask(raw_labels=raw)
        for x in (245,250,255,260):
            self.assertEqual(float(alpha[430,x]), 0.)

    def test_hand_or_unobservable_source_jaw_keeps_original_permission(self):
        old, skin = feature_masks(self.raw,self.edited,self.occ,1.)
        for change in [dict(source_labels=np.zeros_like(self.source)),
                       dict(source_occlusion=np.zeros_like(self.occ))]:
            alpha, actual_skin, detail = self.run_mask(**change)
            np.testing.assert_array_equal(alpha,old)
            np.testing.assert_array_equal(actual_skin,skin)
            self.assertEqual(detail['reason'],'source-jaw-not-visible')

    def test_no_added_chin_and_clipped_source_jaw_are_unchanged(self):
        for edited, points, reason in [(self.raw,self.points,'no-outward-jaw-motion'),
                                      (self.edited,self.points+300,'source-jaw-outside-crop')]:
            old,_=feature_masks(self.raw,edited,self.occ,1.)
            alpha,_,detail=self.run_mask(edited_labels=edited,source_points=points)
            np.testing.assert_array_equal(alpha,old)
            self.assertEqual(detail['reason'],reason)

    def test_far_or_disconnected_generated_skin_cannot_grant_permission(self):
        edited=self.raw.copy()
        edited[480:490,230:280]=1
        old,_=feature_masks(self.raw,edited,self.occ,1.)
        alpha,_,detail=self.run_mask(edited_labels=edited)
        np.testing.assert_array_equal(alpha,old)
        self.assertEqual(detail['extensionPixels'],0)

    def test_projection_preserves_scene_pixels_outside_permission(self):
        alpha,skin,_=self.run_mask()
        frame=np.full((600,600,3),70,np.uint8)
        raw=np.full((512,512,3),80,np.uint8)
        edited=np.full((512,512,3),120,np.uint8)
        matrix=np.array([[1,0,-30.25],[0,1,-40.75]],np.float32)
        out,permission=absolute_composite(frame,raw,edited,matrix,alpha,skin)
        np.testing.assert_array_equal(out[permission==0],frame[permission==0])

    def test_rule_follows_detected_geometry_at_different_crop_positions(self):
        baseline,_,_=self.run_mask()
        for dx,dy in [(18,12),(-22,-16),(7,-30)]:
            matrix=np.array([[1,0,dx],[0,1,dy]],np.float32)
            shift=lambda x:cv2.warpAffine(x,matrix,(512,512),flags=cv2.INTER_NEAREST)
            alpha,_,detail=self.run_mask(raw_labels=shift(self.raw),edited_labels=shift(self.edited),
                source_labels=shift(self.source),source_points=self.points+[dx,dy])
            self.assertIsNone(detail['reason'])
            np.testing.assert_array_equal(alpha,shift(baseline))

    def test_invalid_geometry_and_unknown_source_permission_are_rejected(self):
        for change in [dict(source_points=np.zeros((5,2))),
                       dict(source_points=np.full((68,2),np.nan)),
                       dict(source_occlusion=np.full((512,512),np.nan)),
                       dict(source_labels=np.full((512,512),99,dtype=np.uint8))]:
            with self.assertRaises(ValueError):self.run_mask(**change)


if __name__=='__main__':unittest.main()
