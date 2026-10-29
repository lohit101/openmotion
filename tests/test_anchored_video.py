"""Decoded-frame order and recovery guards; no GPU/model inference."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import anchored_video as media


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'FFmpeg required')
class AnchoredVideoTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.source = self.folder/'prepared-source.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=size=128x96:rate=24',
            '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t',str(15/24),'-frames:v','15',
            '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',str(self.source)], check=True)
        self.request = {'version':'bidirectional-v1','jobId':'fixture','anchorFrame':6,'frames':15,'width':128,'height':96,'fps':24,'sourceSHA256':media.sha(self.source)}

    def tearDown(self):
        self.temp.cleanup()

    def test_directional_sources_and_join_keep_every_original_frame_once(self):
        first = media.prepare(self.folder,self.request)
        self.assertEqual(first,media.prepare(self.folder,self.request))
        self.assertTrue(first['decodedFramesExact'])
        root = self.folder/'anchor-media'
        source_hashes = media.hashes(self.source)
        self.assertEqual(media.hashes(root/'backward.mkv'),list(reversed(source_hashes[:7])))
        self.assertEqual(media.hashes(root/'forward.mkv'),source_hashes[6:])
        request = {k:self.request[k] for k in ['version','jobId','frames','anchorFrame','fps','sourceSHA256']}
        request['branches'] = [{'direction':d,'frames':n,'file':str(root/(d+'.mkv')),'sha256':media.sha(root/(d+'.mkv'))} for d,n in [('backward',7),('forward',9)]]
        receipt = media.assemble(self.folder,request)
        self.assertEqual(receipt['anchorCopies'],1)
        self.assertEqual(receipt['frames'],15)
        self.assertEqual(media.hashes(root/'master.mkv'),source_hashes)
        self.assertEqual(media.info(self.folder/'final.mp4')['frames'],15)
        self.assertEqual(receipt,media.assemble(self.folder,request))
        streams=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(self.folder/'final.mp4')]))['streams']
        self.assertTrue(any(s['codec_type']=='audio' for s in streams))
        final_hash = media.sha(self.folder/'final.mp4')
        with (root/'forward.mkv').open('ab') as f:f.write(b'changed')
        with self.assertRaisesRegex(ValueError,'paid branch changed'):
            media.assemble(self.folder,request)
        self.assertEqual(media.sha(self.folder/'final.mp4'),final_hash)

    def test_changed_source_or_anchor_cannot_overwrite_saved_directional_work(self):
        receipt = media.prepare(self.folder,self.request)
        old_hash = receipt['outputs']['backward.mkv']
        with self.assertRaisesRegex(ValueError,'different frozen inputs'):
            media.prepare(self.folder,{**self.request,'anchorFrame':7})
        self.assertEqual(media.sha(self.folder/'anchor-media/backward.mkv'),old_hash)
        with self.source.open('ab') as f:f.write(b'changed')
        with self.assertRaisesRegex(ValueError,'Prepared source changed'):
            media.prepare(self.folder,self.request)

    def test_short_edges_are_explicitly_rejected_without_padding(self):
        for anchor in [0,1,3,11,14]:
            with self.subTest(anchor=anchor),self.assertRaisesRegex(ValueError,'Invalid directional frame range'):
                media.prepare(self.folder,{**self.request,'anchorFrame':anchor})
        self.assertFalse((self.folder/'anchor-media/backward.mkv').exists())

    def test_request_cannot_change_the_native_frame_rate(self):
        with self.assertRaisesRegex(ValueError, 'Invalid directional frame range'):
            media.prepare(self.folder, {**self.request, 'fps': 30})
        self.assertFalse((self.folder/'anchor-media/backward.mkv').exists())

    def test_explicit_export_canvas_preserves_downsampled_branch_pixels(self):
        media.prepare(self.folder, self.request)
        root = self.folder/'anchor-media'
        branches = []
        for direction, frames in [('backward', 7), ('forward', 9)]:
            file = root/(direction+'-export.mkv')
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(root/(direction+'.mkv')),
                '-vf', 'scale=96:72', '-an', '-c:v', 'ffv1', '-pix_fmt', 'yuv420p', str(file)], check=True)
            branches.append({'direction': direction, 'frames': frames, 'file': str(file), 'sha256': media.sha(file)})
        request = {k:self.request[k] for k in ['version','jobId','frames','anchorFrame','fps','sourceSHA256']}
        request.update(width=96, height=72, branches=branches)
        media.assemble(self.folder, request)
        self.assertEqual((media.info(root/'master.mkv')['width'], media.info(root/'master.mkv')['height']), (96, 72))
        self.assertEqual(media.hashes(root/'master.mkv'), list(reversed(media.hashes(branches[0]['file'])))[:-1] + media.hashes(branches[1]['file']))
        self.assertEqual(media.info(self.folder/'final.mp4')['frames'], 15)


if __name__=='__main__':unittest.main()
