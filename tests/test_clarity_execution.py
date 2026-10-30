"""CPU-only Clarity transport/color orchestration; never loads AI weights."""
import importlib.util
import hashlib
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from clarity_execution import DeviceColorCorrector, PhaseTimings, cpu_threads, streamed_input, move_verified_bridge, processing_geometry, export_filter


class ClarityExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.original_threads = torch.get_num_threads()
        torch.set_num_threads(2)

    def tearDown(self):
        torch.set_num_threads(self.original_threads)
        self.temp.cleanup()

    def source(self, fps='24', frames=13, extra=()):
        path = self.root / 'source.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=s=96x54:r={fps}',
                        '-frames:v', str(frames), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', *extra, str(path)], check=True)
        return path

    def test_stream_matches_legacy_rgb_at_fractional_rates_and_window_boundaries(self):
        g = dict(workWidth=256, workHeight=128, outputWidth=144, outputHeight=82, padX=56, padY=22)
        for fps,extra in [('24',()),('30000/1001',()),('24',('-colorspace','bt709','-color_range','tv')),('24',('-color_range','pc'))]:
            source = self.source(fps,extra=extra)
            legacy = self.root / 'prepared.mkv'
            vf = 'setpts=PTS-STARTPTS,scale=144:82:flags=lanczos,pad=256:128:56:22:color=black,setsar=1'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(source), '-an', '-vf', vf,
                            '-c:v', 'ffv1', '-pix_fmt', 'yuv420p', '-level', '3', '-threads', '2', str(legacy)], check=True)
            capture = cv2.VideoCapture(str(legacy)); expected = []
            try:
                while True:
                    ok, value = capture.read()
                    if not ok:
                        break
                    expected.append(cv2.cvtColor(value, cv2.COLOR_BGR2RGB))
            finally:
                capture.release()
            timings = PhaseTimings()
            windows = list(streamed_input(source, g, dict(frames=13, fps=fps), chunk_frames=4,
                                          first_chunk_frames=5, timings=timings, threads=2))
            self.assertEqual([v.shape[2] for v in windows], [5, 4, 4])
            result = torch.cat(windows, dim=2)
            reference = torch.from_numpy(np.stack(expected)).permute(3, 0, 1, 2).unsqueeze(0).float().div(127.5).sub(1)
            torch.testing.assert_close(result, reference, rtol=0, atol=0)
            self.assertGreater(timings.seconds['inputStreaming'], 0)

    def test_stream_refuses_missing_or_additional_frames(self):
        source = self.source(frames=5)
        g = dict(workWidth=128, workHeight=128, outputWidth=96, outputHeight=54, padX=16, padY=36)
        for frames in (4, 6):
            with self.assertRaisesRegex(ValueError, 'frames|decoding'):
                list(streamed_input(source, g, dict(frames=frames), chunk_frames=4))

    def test_early_close_terminates_input_decoder(self):
        source = self.source(frames=50)
        g = dict(workWidth=128, workHeight=128, outputWidth=96, outputHeight=54, padX=16, padY=36)
        native = subprocess.Popen; children = []
        def start(*args, **kwargs):
            child = native(*args, **kwargs); children.append(child); return child
        with patch('clarity_execution.subprocess.Popen', side_effect=start):
            iterator = streamed_input(source, g, dict(frames=50), chunk_frames=4)
            next(iterator); iterator.close()
        decoders=[p for p in children if p.args[0]=='ffmpeg']
        self.assertEqual(len(decoders), 1)
        self.assertIsNotNone(decoders[0].poll())

    def test_color_windows_preserve_values_and_fallback_without_any_gpu(self):
        # A deterministic stand-in checks device/chunk plumbing independently
        # of upstream model code. The actual pinned wavelet is checked below.
        class Native:
            def __init__(self, **kwargs):
                self.kwargs = kwargs
            def __call__(self, generated, reference):
                return generated * .75 + reference * .25
        torch.manual_seed(17)
        content, reference = torch.rand(1, 3, 7, 24, 32), torch.rand(1, 3, 7, 24, 32)
        stats = {}; timings = PhaseTimings()
        with patch.object(torch.cuda, 'is_available', return_value=False):
            corrector = DeviceColorCorrector(Native, levels=5, chunk_size=16, stats=stats, timings=timings)
            result = corrector(content, reference)
        torch.testing.assert_close(result, Native()(content, reference), rtol=0, atol=0)
        self.assertEqual(corrector.native.kwargs, dict(levels=5, chunk_size=2))
        self.assertEqual(stats['colorCPUFrames'], 7)
        self.assertEqual(stats['colorCUDAFrames'], 0)
        self.assertGreater(timings.seconds['colorMatching'], 0)
        with patch.object(torch.cuda, 'is_available', return_value=True), \
             patch.object(torch.cuda, 'mem_get_info', return_value=(100, 100)), \
             patch.object(torch.cuda, 'empty_cache') as empty:
            low = DeviceColorCorrector(Native)
            torch.testing.assert_close(low(content, reference), result, rtol=0, atol=0)
            self.assertEqual(low.stats['colorCPUFrames'], 7)
            empty.assert_not_called()

        # Emulate CUDA placement with CPU tensors so the OOM/TF32 restoration
        # branch is exercised without creating a real CUDA context.
        class OneOOM(Native):
            failed = False
            def __call__(self, generated, reference):
                if not self.failed:
                    self.failed = True
                    raise torch.cuda.OutOfMemoryError('synthetic color workspace')
                return super().__call__(generated, reference)
        original_to = torch.Tensor.to
        def cpu_only(value, *args, **kwargs):
            if args and str(args[0]) == 'cuda:0':
                args = ('cpu', *args[1:])
            return original_to(value, *args, **kwargs)
        previous_tf32 = torch.backends.cudnn.allow_tf32
        with patch.object(torch.cuda, 'is_available', return_value=True), \
             patch.object(torch.cuda, 'mem_get_info', return_value=(10**12, 10**12)), \
             patch.object(torch.cuda, 'empty_cache') as empty, \
             patch.object(torch.Tensor, 'to', cpu_only):
            stats = {}; corrector = DeviceColorCorrector(OneOOM, stats=stats)
            result = corrector(content, reference)
            empty.assert_called_once()
        torch.testing.assert_close(result, Native()(content, reference), rtol=0, atol=0)
        self.assertEqual(stats, dict(colorCUDAFrames=5, colorCPUFrames=2, colorOOMFallbacks=1))
        self.assertEqual(torch.backends.cudnn.allow_tf32, previous_tf32)

    def test_pinned_wavelet_cpu_values_are_unchanged_when_available(self):
        # No source fetch in tests. A local, already-audited pinned checkout is
        # optional; portable tests above always exercise the device adapter.
        file = ROOT / '.local/clarity-audit/inference/postprocessing/color_correction.py'
        if not file.is_file():
            self.skipTest('Pinned offline source cache not present')
        spec = importlib.util.spec_from_file_location('clarity_test_wavelet', file)
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        torch.manual_seed(21)
        content, reference = torch.rand(1, 3, 7, 48, 64).to(torch.bfloat16), torch.rand(1, 3, 7, 48, 64)
        with patch.object(torch.cuda, 'is_available', return_value=False):
            actual = DeviceColorCorrector(module.WaveletColorCorrector)(content, reference)
            expected = module.WaveletColorCorrector()(content, reference)
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)

    def test_verified_bridge_moves_without_reencoding_or_audio_remux(self):
        original = self.root / 'temporary.mkv'; final = self.root / 'working.mkv'
        original.write_bytes(b'unchanged lossless video')
        digest = hashlib.sha256(original.read_bytes()).hexdigest()
        move_verified_bridge(original, 'original-audio-is-restored-in-final-export', final)
        self.assertFalse(original.exists())
        self.assertEqual(hashlib.sha256(final.read_bytes()).hexdigest(), digest)

    def test_cpu_helpers_respect_affinity_and_cgroup_quota(self):
        with patch('clarity_execution.os.cpu_count', return_value=192), \
             patch('clarity_execution.os.sched_getaffinity', return_value={0, 1, 2}, create=True), \
             patch('clarity_execution.Path.read_text', return_value='150000 100000'):
            self.assertEqual(cpu_threads(), 2)
        with patch('clarity_execution.os.cpu_count', return_value=192), \
             patch('clarity_execution.os.sched_getaffinity', return_value=set(range(192)), create=True), \
             patch('clarity_execution.Path.read_text', return_value='max 100000'):
            self.assertEqual(cpu_threads(), 8)

    def test_fast1080_preserves_final_target_and_requires_frozen_720_ai_dimensions(self):
        native = dict(outputWidth=1944,outputHeight=1080,workWidth=2048,workHeight=1152,padX=52,padY=36)
        fast = dict(outputWidth=1296,outputHeight=720,workWidth=1408,workHeight=768,padX=56,padY=24)
        request = dict(input=dict(width=864,height=480),settings=dict(height=1080),geometry=native)
        self.assertEqual(processing_geometry(request), native)
        request['settings']['processing']='fast1080'
        with self.assertRaisesRegex(ValueError,'frozen'):
            processing_geometry(request)
        request['processingGeometry']=fast
        self.assertEqual(processing_geometry(request),fast)
        self.assertEqual(export_filter(fast,native),'scale=1944:1080:flags=lanczos,setsar=1')
        self.assertEqual(export_filter(native,native),'setsar=1')
        request['settings']['processing']='native'
        with self.assertRaisesRegex(ValueError,'Native'):
            processing_geometry(request)


if __name__ == '__main__':
    unittest.main()
