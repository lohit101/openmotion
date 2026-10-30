"""Offline media contracts, using synthetic pixels; no weights or GPU inference."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from clarity_video import ClarityVideoWriter
from upscale_worker import info, validate_source, profile_hash


class ClarityMediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def encode(self, name, *args):
        path = self.root / name
        subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', *args, str(path)], check=True)
        return path

    def test_full_rgb_round_trip_and_fractional_rate_without_padding_in_output(self):
        rng = np.random.default_rng(7)
        for fps in ('24', '30000/1001'):
            geometry = dict(workWidth=128, workHeight=128, outputWidth=90, outputHeight=62, padX=18, padY=32)
            writer = ClarityVideoWriter(self.root / (fps.replace('/', '-') + '.mkv'), fps, geometry)
            expected = hashlib.sha256()
            for _ in range(9):
                frame = rng.integers(0, 256, (128, 128, 3), dtype=np.uint8)
                expected.update(frame[32:94, 18:108].tobytes())
                writer.append_frame(frame)
            writer.close()
            verified = writer.verify()
            self.assertEqual(verified['rgbSHA256'], expected.hexdigest())
            self.assertEqual((verified['frames'], verified['width'], verified['height'], verified['fps']), (9, 90, 62, fps))

    def test_rejects_variable_timing_before_inference(self):
        file = self.encode('vfr.mkv', '-f', 'lavfi', '-i', 'testsrc2=s=64x96:r=24:d=1',
                           '-vf', "select='not(eq(n,4))'", '-fps_mode', 'vfr', '-c:v', 'ffv1')
        with self.assertRaisesRegex(ValueError, 'constant-frame-rate'):
            info(file)

    def test_rotation_uses_display_dimensions(self):
        original = self.encode('original.mp4', '-f', 'lavfi', '-i', 'testsrc2=s=64x96:r=24:d=0.5', '-c:v', 'libx264')
        rotated = self.encode('rotated.mp4', '-display_rotation', '90', '-i', str(original), '-c', 'copy')
        self.assertEqual(info(rotated), dict(width=96, height=64, frames=12, fps='24'))

    def test_hdr_and_incompatible_audio_are_declined_before_inference(self):
        hdr = self.encode('hdr.mp4', '-f', 'lavfi', '-i', 'testsrc2=s=64x96:r=24:d=0.5', '-c:v', 'libx264', '-vf', 'setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc', '-x264-params', 'colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc')
        with self.assertRaisesRegex(ValueError, 'HDR'):
            info(hdr)
        pcm = self.encode('pcm.mkv', '-f', 'lavfi', '-i', 'testsrc2=s=64x96:r=24:d=0.5',
                          '-f', 'lavfi', '-i', 'sine=d=0.5', '-c:v', 'ffv1', '-c:a', 'pcm_s16le')
        with self.assertRaisesRegex(ValueError, 'MP4-compatible audio'):
            validate_source(pcm)

    def test_final_export_preserves_timeline_and_original_audio_payload(self):
        source = self.encode('audio.mp4', '-f', 'lavfi', '-i', 'testsrc2=s=64x96:r=24:d=0.5',
                             '-f', 'lavfi', '-i', 'sine=d=0.5', '-c:v', 'libx264', '-c:a', 'aac', '-shortest')
        final = self.encode('export.mp4', '-i', str(source), '-map', '0:v:0', '-map', '0:a:0?',
                            '-vf', 'scale=128:192', '-r', '24', '-fps_mode', 'cfr', '-frames:v', '12',
                            '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart')
        self.assertEqual(info(final), dict(width=128, height=192, frames=12, fps='24'))
        def audio(file):
            return subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(file), '-map', '0:a:0', '-c:a', 'copy', '-f', 'data', '-'])
        self.assertEqual(audio(source), audio(final))

    def test_runtime_fingerprint_and_minimal_model_manifest(self):
        root = Path(__file__).resolve().parents[1]
        names = ['config/upscale-runtime.lock.json', 'config/upscale-models.lock.json', 'scripts/upscale_worker.py', 'scripts/clarity_video.py']
        self.assertEqual(profile_hash(), hashlib.sha256(b''.join((root / name).read_bytes() for name in names)).hexdigest())
        manifest = json.loads((root / names[1]).read_text())
        self.assertEqual(sum(f['size'] for f in manifest['files']), 7016472997)
        self.assertEqual(len(manifest['files']), 3)
        self.assertTrue(all(len(f['sha256']) == 64 and f['destination'].startswith('upscale/') for f in manifest['files']))


if __name__ == '__main__':
    unittest.main()
