import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('video_identity_test',ROOT/'scripts/video_identity.py')
video=importlib.util.module_from_spec(spec);spec.loader.exec_module(video)


class VideoIdentityTests(unittest.TestCase):
    def test_fractional_rate_uses_actual_decoded_timestamps(self):
        fixture={'streams':[{'width':64,'height':96,'avg_frame_rate':'24000/1001'}],
                 'frames':[{'best_effort_timestamp_time':str(i*1001/24000)} for i in range(10)]}
        with patch.object(video.subprocess,'check_output',return_value=json.dumps(fixture)):
            self.assertEqual(video.video_info('fixture')['frames'],10)
            self.assertEqual(video.video_info('fixture')['fps'],'24000/1001')
        fixture['frames'][5]['best_effort_timestamp_time']='0.5'
        with patch.object(video.subprocess,'check_output',return_value=json.dumps(fixture)):
            with self.assertRaisesRegex(ValueError,'Variable frame timing'):video.video_info('fixture')

    def test_facial_permission_protects_body_and_scene_with_exact_zeros(self):
        frame=np.full((256,192,3),127,np.uint8);mask=video.face_permission(frame,[50,30,120,130])
        self.assertTrue(np.all(mask[150:]==0));self.assertTrue(np.all(mask[:20]==0));self.assertTrue(np.all(mask[:,:40]==0))
        edited=np.rint(frame*(1-mask[...,None])).astype(np.uint8)
        self.assertTrue(np.array_equal(edited[mask==0],frame[mask==0]));self.assertGreater(mask[80,85],.99)

    def test_output_cannot_replace_input_directory(self):
        with tempfile.TemporaryDirectory() as root,patch.object(video,'status',return_value={'ready':True}):
            with self.assertRaisesRegex(ValueError,'separate directory'):
                video.run(Path(root)/'ref.png',Path(root)/'final.mp4',root)

    def test_missing_local_models_never_trigger_download_or_inference(self):
        with patch.object(video,'status',return_value={'ready':False,'setup':'explicit setup'}),patch.object(video.urllib.request,'urlopen') as network:
            with self.assertRaisesRegex(ValueError,'Nothing was downloaded'):video.run('ref','target','new-output')
            network.assert_not_called()


if __name__=='__main__':unittest.main()
