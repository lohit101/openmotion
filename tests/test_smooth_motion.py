"""CPU/FFmpeg checks. No GPU, server changes or model downloads."""
from fractions import Fraction
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import hashlib
import sys

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('smooth_motion_node', ROOT / 'custom_nodes/recast_post_processing/motion.py')
motion = importlib.util.module_from_spec(spec); spec.loader.exec_module(motion)


class SmoothMotionTests(unittest.TestCase):
    def test_explicit_tool_install_keeps_local_edits_and_links_protected(self):
        sys.path.insert(0,str(ROOT/'scripts'))
        from managed_openjutsu_tools import install_local_nodes
        def request(text):return {'local_nodes':[{'directory':'recast_post_processing','files':{name:{'content':text,'sha256':hashlib.sha256(text.encode()).hexdigest()} for name in ['__init__.py','motion.py']}}]}
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'custom_nodes').mkdir();install_local_nodes(root,request('version one'))
            install_local_nodes(root,request('version two'));source=root/'custom_nodes/recast_post_processing/motion.py'
            self.assertEqual(source.read_text(),'version two');source.write_text('user edit')
            with self.assertRaisesRegex(ValueError,'edited locally'):install_local_nodes(root,request('version three'))
            self.assertEqual(source.read_text(),'user edit')
            source.unlink();source.symlink_to(root/'outside.py')
            with self.assertRaisesRegex(ValueError,'linked'):install_local_nodes(root,request('version three'))

    def test_tool_install_rejects_unknown_packages_before_writing(self):
        sys.path.insert(0,str(ROOT/'scripts'))
        from managed_openjutsu_tools import install_local_nodes
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,'Unknown'):install_local_nodes(d,{'local_nodes':[{'directory':'../outside','files':{}}]})
            self.assertEqual(list(Path(d).iterdir()),[])

    def test_exact_arbitrary_timestamps_for_30_and_60(self):
        self.assertEqual([motion.sample_position(k,Fraction(24),30) for k in range(6)],[(0,0.),(0,.8),(1,.6),(2,.4),(3,.2),(4,0.)])
        self.assertEqual([motion.sample_position(k,Fraction(24),60) for k in range(6)],[(0,0.),(0,.4),(0,.8),(1,.2),(1,.6),(2,0.)])

    def test_double_rate_keeps_original_sample_positions(self):
        self.assertEqual([motion.sample_position(k,Fraction(24),48) for k in range(5)],[(0,0.),(0,.5),(1,0.),(1,.5),(2,0.)])

    def test_duration_rounding_and_fractional_source_rates(self):
        self.assertEqual(motion.output_count('9.833333',60),590)
        self.assertEqual(motion.output_count('10',30),300)
        left,t=motion.sample_position(30,Fraction(30000,1001),60)
        self.assertEqual(left,14);self.assertAlmostEqual(t,986/1001)

    def test_cut_veto_and_continuous_scene(self):
        a=np.full((64,96,3),40,dtype=np.uint8);b=np.full_like(a,220)
        self.assertTrue(motion.scene_cut(a,b));self.assertFalse(motion.scene_cut(a,a+5))

    def test_decoder_partial_frame_is_rejected(self):
        self.assertIsNone(motion.read_frame(io.BytesIO(),12))
        with self.assertRaisesRegex(ValueError,'incomplete'):motion.read_frame(io.BytesIO(b'partial'),12)

    def test_hdr_and_unsupported_duration_are_rejected(self):
        data={'streams':[{'codec_type':'video','width':96,'height':64,'avg_frame_rate':'24/1','duration':'1','color_transfer':'smpte2084'}]}
        with patch.object(motion.subprocess,'check_output',return_value=json.dumps(data)):
            with self.assertRaisesRegex(ValueError,'HDR'):motion.probe('unused')
        data['streams'][0].update(duration='301',color_transfer='bt709')
        with patch.object(motion.subprocess,'check_output',return_value=json.dumps(data)):
            with self.assertRaisesRegex(ValueError,'five minutes'):motion.probe('unused')

    def make_video(self,folder,rate=24,audio=True,cut=False):
        video=folder/'input.mp4'
        graph='color=red:s=96x64:r=%s:d=0.5[a];color=blue:s=96x64:r=%s:d=0.5[b];[a][b]concat=n=2:v=1:a=0'% (rate,rate) if cut else f'testsrc2=s=96x64:r={rate}:d=1'
        args=['ffmpeg','-v','error','-y','-f','lavfi','-i',graph]
        if audio:args+=['-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1']
        args+=['-c:v','libx264','-pix_fmt','yuv420p']
        if audio:args+=['-c:a','aac']
        subprocess.run([*args,str(video)],check=True,capture_output=True)
        return video

    def packets(self,file):
        data=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a:0','-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash','-of','json',str(file)]))
        return [p['data_hash'] for p in data.get('packets',[])]

    def test_streamed_24_to_30_preserves_exact_duration_frames_and_aac_packets(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=self.make_video(root);out=root/'output.mp4';times=[]
            def predict(a,b,t):times.append(t);return np.round(a.astype(float)*(1-t)+b.astype(float)*t).astype(np.uint8)
            result=motion.finish_video(source,out,30,predict)
            info=motion.probe(out)
            self.assertEqual(result['frames'],30);self.assertEqual(info['fps'],30);self.assertAlmostEqual(info['duration'],1)
            self.assertIn(.8,times);self.assertEqual(self.packets(source),self.packets(out))
            frames=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','json',str(out)]))
            self.assertEqual(int(frames['streams'][0]['nb_read_frames']),30)

    def test_60fps_output_keeps_no_audio_and_skips_detected_cut(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=self.make_video(root,audio=False,cut=True);out=root/'output.mp4'
            result=motion.finish_video(source,out,60,lambda a,b,t:a)
            self.assertEqual(result['frames'],60);self.assertGreater(result['cutFrames'],0)
            self.assertFalse(motion.probe(out)['audio'])
            raw=subprocess.check_output(['ffmpeg','-v','error','-i',str(out),'-pix_fmt','rgb24','-f','rawvideo','pipe:1'])
            frames=np.frombuffer(raw,dtype=np.uint8).reshape(60,64,96,3)
            self.assertGreater(frames[29,...,0].mean(),200)
            self.assertGreater(frames[30,...,2].mean(),200)

    def test_downsampling_uses_existing_frames_without_prediction(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=self.make_video(root,rate=60,audio=False);out=root/'output.mp4'
            def predict(*_):self.fail('Exact downsampling must not synthesize frames')
            motion.finish_video(source,out,30,predict);self.assertEqual(motion.probe(out)['fps'],30)

    def test_phone_rotation_metadata_is_baked_without_changing_display_orientation(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=self.make_video(root,audio=False);rotated=root/'rotated.mp4';out=root/'output.mp4'
            tag=subprocess.run(['ffmpeg','-v','error','-y','-display_rotation','90','-i',str(source),'-c','copy',str(rotated)],capture_output=True)
            if tag.returncode:
                # Older FFmpeg releases write this through the stream tag.
                subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-c','copy','-metadata:s:v:0','rotate=90',str(rotated)],check=True)
            self.assertEqual((motion.probe(rotated)['width'],motion.probe(rotated)['height']),(64,96))
            motion.finish_video(rotated,out,30,lambda a,b,t:a)
            self.assertEqual((motion.probe(out)['width'],motion.probe(out)['height']),(64,96))

    def test_cancellation_stops_decoder_and_encoder(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=self.make_video(root,audio=False)
            def cancel():raise RuntimeError('cancelled')
            with self.assertRaisesRegex(RuntimeError,'cancelled'):motion.finish_video(source,root/'partial.mp4',60,lambda a,b,t:a,cancel)


if __name__=='__main__':unittest.main()
