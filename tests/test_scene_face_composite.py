"""Scene-native integration must preserve protected pixels and reject bad transforms."""
import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from scene_face_composite import composite_scene_face
from facial_runtime import profile_hash

class SceneFaceCompositeTests(unittest.TestCase):
    def test_legacy_fingerprint_is_frozen_and_scene_version_is_distinct(self):
        self.assertEqual(profile_hash(),'ef8f273a320b6d34c5efccf690610ad92f1aac0fdb9c4d60c4906557ade5b419')
        self.assertNotEqual(profile_hash(),profile_hash('source-face-v2'))
        with self.assertRaises(ValueError):profile_hash('unknown')
    def test_no_change_delta_does_not_resample_the_base_scene(self):
        frame=np.random.default_rng(7).integers(0,256,(96,80,3),dtype=np.uint8)
        crop=np.full((64,64,3),110,np.uint8);permission=np.ones((64,64),np.float32)
        result=composite_scene_face(frame,crop,crop.copy(),np.array([[.83,0,1.3],[0,.83,.7]],np.float32),permission)
        np.testing.assert_array_equal(result,frame)
    def test_edit_respects_exact_protected_background_and_occlusion_hole(self):
        frame=np.full((96,96,3),90,np.uint8);crop=np.full((64,64,3),90,np.uint8);edited=np.full_like(crop,145)
        permission=np.zeros((64,64),np.float32);permission[10:54,10:54]=1;permission[28:38,28:38]=0
        frame_before,crop_before,mask_before=frame.copy(),crop.copy(),permission.copy()
        result=composite_scene_face(frame,crop,edited,np.array([[1,0,-16],[0,1,-16]],np.float32),permission)
        np.testing.assert_array_equal(result[:20],frame[:20]);np.testing.assert_array_equal(result[45:53,45:53],frame[45:53,45:53])
        self.assertGreater(result[36,36,0],90)
        np.testing.assert_array_equal(frame,frame_before);np.testing.assert_array_equal(crop,crop_before);np.testing.assert_array_equal(permission,mask_before)
    def test_empty_permission_is_an_exact_copy_and_invalid_inputs_are_rejected(self):
        frame=np.full((64,64,3),100,np.uint8);affine=np.array([[1,0,0],[0,1,0]],np.float32);mask=np.zeros((64,64),np.float32)
        np.testing.assert_array_equal(composite_scene_face(frame,frame,frame,affine,mask),frame)
        for bad in[np.zeros((2,3),np.float32),np.full((2,3),np.nan,np.float32)]:
            with self.assertRaises(ValueError):composite_scene_face(frame,frame,frame,bad,mask)
        with self.assertRaises(ValueError):composite_scene_face(frame,frame,frame,affine,mask[:5])

if __name__=='__main__':unittest.main()
