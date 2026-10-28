import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import numpy as np
from source_face_performance import compatible_faces,feature_mask,pose_proxy,transfer_features
from video_identity import face_permission


def face():
    points=np.zeros((68,2),np.float32)
    for start,end,cx,cy,rx,ry in [(36,42,200,240,25,8),(42,48,312,240,25,8),(48,60,256,350,40,16)]:
        angles=np.linspace(0,2*np.pi,end-start,endpoint=False)
        points[start:end]=np.stack([cx+rx*np.cos(angles),cy+ry*np.sin(angles)],axis=1)
    return types.SimpleNamespace(score_set={'landmarker':.95},bounding_box=np.array([140,130,372,420]),landmark_set={'5/68':np.array([[200,240],[312,240],[256,292],[220,350],[292,350]],np.float32),'68':points})


class SourcePerformanceTests(unittest.TestCase):
    def test_alignment_is_scale_rotation_translation_invariant(self):
        p=face().landmark_set['5/68'];angle=.4;r=np.array([[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]])
        before=pose_proxy(p);after=pose_proxy((p@r.T)*1.5+[5,9]);self.assertAlmostEqual(before[1],after[1]);self.assertAlmostEqual(before[2],after[2])

    def test_uncertain_tiny_and_mismatched_faces_keep_identity_only(self):
        a,b=face(),face();a.score_set['landmarker']=.4;self.assertEqual(compatible_faces(a,b),'uncertain-source-face')
        a=face();a.landmark_set['5/68']*=.1;self.assertEqual(compatible_faces(a,b),'face-too-small')
        a=face();a.landmark_set['5/68'][2,0]+=70;self.assertEqual(compatible_faces(a,b),'source-output-pose-mismatch')

    def test_feature_mask_does_not_expand_to_forehead_or_jaw(self):
        f=face();m=feature_mask(f.landmark_set['68'],np.array([[1,0,0],[0,1,0]],np.float32))
        self.assertEqual(m[140,256],0);self.assertEqual(m[420,256],0);self.assertGreater(m[240,200],.99)

    def transfer(self,occlusion):
        source=np.full((512,512,3),80,np.uint8);target=np.full_like(source,120);swapped=np.full_like(source,200);f=face()
        permission=face_permission(target,f.bounding_box);identity=target.copy();identity[permission>.5]=150
        # Outside-face pixels in the direct baseline obey the existing contract.
        identity[permission==0]=target[permission==0]
        def warp(frame,_points,_template,_size):return frame.copy(),np.array([[1,0,0],[0,1,0]],np.float32)
        helper=types.SimpleNamespace(warp_face_by_face_landmark_5=warp)
        masker=types.SimpleNamespace(create_occlusion_mask=lambda frame:np.full((512,512),occlusion,np.float32))
        with patch.dict(sys.modules,{'facefusion.face_helper':helper,'facefusion.face_masker':masker}):
            output,record=transfer_features(source,f,swapped,target,f,identity)
        return output,record,target,identity,permission

    def test_source_features_preserve_exact_protected_output_pixels(self):
        output,record,target,identity,permission=self.transfer(1)
        self.assertEqual(record['performance'],'source-features');self.assertTrue(np.array_equal(output[permission==0],target[permission==0]));self.assertTrue(np.array_equal(output[140,256],identity[140,256]));self.assertGreater(int(output[240,200,0]),150)

    def test_occluded_source_keeps_direct_swap_and_reports_fallback(self):
        output,record,_target,identity,_permission=self.transfer(0)
        self.assertTrue(np.array_equal(output,identity));self.assertEqual(record,{'performance':'identity-only','reason':'features-occluded'})


if __name__=='__main__':unittest.main()
