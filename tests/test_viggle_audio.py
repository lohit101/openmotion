import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

import torch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('viggle_audio_test', ROOT / 'custom_nodes/character_swap_helpers/audio.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Nested:
    is_nested = True
    def __init__(self, tensors): self.tensors = tuple(tensors)
    def unbind(self): return self.tensors


class FakeVAE:
    audio_sample_rate = 32000
    def encode(self, waveform):
        self.received = waveform
        return torch.full((1, 32, 2, 152), .37)


class SourceAudioTests(unittest.TestCase):
    def setUp(self):
        self.comfy = types.ModuleType('comfy')
        self.comfy.audio = types.ModuleType('comfy.audio')
        self.comfy.nested_tensor = types.ModuleType('comfy.nested_tensor')
        self.comfy.nested_tensor.NestedTensor = Nested
        self.modules = patch.dict(sys.modules, {'comfy': self.comfy, 'comfy.audio': self.comfy.audio,
                                               'comfy.nested_tensor': self.comfy.nested_tensor})
        self.modules.start()
        self.latent = {'samples': Nested((torch.randn(1, 24, 27, 4, 2), torch.zeros(1, 32, 2, 150))), 'receipt': 'preserve'}
        self.audio = {'waveform': torch.ones(1, 1, 104000), 'sample_rate': 32000}
    def tearDown(self): self.modules.stop()

    def test_audio_pins_clean_without_touching_video_or_input(self):
        video = self.latent['samples'].unbind()[0].clone()
        vae = FakeVAE()
        result = module.RecastVigglePinAudio().pin(self.latent, self.audio, vae)[0]
        self.assertTrue(torch.equal(video, result['samples'].unbind()[0]))
        self.assertEqual(result['receipt'], 'preserve')
        self.assertTrue((result['samples'].unbind()[1] == .37).all())
        self.assertTrue((result['noise_mask'].unbind()[0] == 1).all())
        self.assertEqual(result['noise_mask'].unbind()[1].count_nonzero(), 0)
        self.assertEqual(self.latent['samples'].unbind()[1].count_nonzero(), 0)
        self.assertEqual(vae.received.shape, (1, 121333, 2))
        self.assertTrue((vae.received[:, :104000] == 1).all())
        self.assertEqual(vae.received[:, 104000:].count_nonzero(), 0)
        self.assertEqual(self.audio['waveform'].shape, (1, 1, 104000))

    def test_five_frame_continuation_mask_is_preserved(self):
        vm = torch.ones(1, 1, 27, 4, 2)
        vm[:, :, :2] = 0
        self.latent['noise_mask'] = Nested((vm, torch.ones(1, 1, 1, 150)))
        result = module.RecastVigglePinAudio().pin(self.latent, self.audio, FakeVAE())[0]
        self.assertTrue(torch.equal(result['noise_mask'].unbind()[0], vm))
        self.assertEqual(result['noise_mask'].unbind()[1].count_nonzero(), 0)

    def test_wrong_grids_and_nonfinite_soundtrack_rejected(self):
        self.audio['waveform'][0, 0, 0] = float('nan')
        with self.assertRaisesRegex(ValueError, 'finite'):
            module.RecastVigglePinAudio().pin(self.latent, self.audio, FakeVAE())
        self.audio['waveform'].zero_()
        self.latent['samples'] = Nested((torch.zeros(1, 24, 27, 4, 2), torch.zeros(1, 32, 2, 149)))
        with self.assertRaisesRegex(ValueError, 'timing grids'):
            module.RecastVigglePinAudio().pin(self.latent, self.audio, FakeVAE())

    def test_silent_video_without_audio_has_a_clear_pre_sampling_error(self):
        with self.assertRaisesRegex(ValueError, 'no soundtrack'):
            module.RecastVigglePinAudio().pin(self.latent, None, FakeVAE())

    def test_wrong_audio_vae_or_short_encoding_rejected(self):
        vae = FakeVAE(); vae.audio_sample_rate = 44100
        with self.assertRaisesRegex(ValueError, '32 kHz'):
            module.RecastVigglePinAudio().pin(self.latent, self.audio, vae)
        vae.audio_sample_rate = 32000
        vae.encode = lambda waveform: torch.zeros(1, 32, 2, 149)
        with self.assertRaisesRegex(ValueError, 'enough finite'):
            module.RecastVigglePinAudio().pin(self.latent, self.audio, vae)


if __name__ == '__main__': unittest.main()
