import importlib.util
from pathlib import Path
import unittest

import torch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('face_reference_test', ROOT / 'custom_nodes/character_swap_helpers/face_reference.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class VAE:
    def __init__(self): self.images = []
    def encode(self, image):
        self.images.append(image.clone())
        return torch.zeros(1, 24, 1, image.shape[1] // 16, image.shape[2] // 16)


class FacialReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tokens = torch.randn(1, 3, 4)
        self.video = {"kind": "video", "latent": torch.ones(1)}
        self.main = {"kind": "image", "latent": torch.ones(1)}
        self.guides = [{"resolved_frame_index": 30}]
        self.condition = [[self.tokens, {"minimax_refs": [self.video, self.main], "minimax_keyframes": self.guides}]]
        self.node = module.RecastViggleFaceReference()

    def test_main_video_reference_tokens_and_guides_remain_unchanged(self):
        crop = torch.rand(1, 80, 64, 3); before = crop.clone(); vae = VAE()
        result, = self.node.append(self.condition, vae, crop, 128)
        self.assertIs(result[0][0], self.tokens)
        self.assertIs(result[0][1]['minimax_refs'][0], self.video)
        self.assertIs(result[0][1]['minimax_refs'][1], self.main)
        self.assertIs(result[0][1]['minimax_keyframes'], self.guides)
        self.assertEqual(len(self.condition[0][1]['minimax_refs']), 2)
        self.assertEqual(vae.images[0].shape, (1, 160, 128, 3))
        self.assertTrue(torch.equal(crop, before))

    def test_each_view_is_a_separate_native_reference(self):
        vae = VAE(); out, = self.node.append(self.condition, vae, torch.rand(3, 64, 64, 3), 128)
        self.assertEqual(len(out[0][1]['minimax_refs']), 5)
        self.assertEqual(len(vae.images), 3)
        with self.assertRaisesRegex(ValueError, 'one facial-reference'):
            self.node.append(out, vae, torch.rand(1, 64, 64, 3), 128)

    def test_invalid_inputs_fail_before_encoding(self):
        for crop in [torch.zeros(4, 64, 64, 3), torch.zeros(1, 64, 200, 3), torch.full((1,64,64,3), float('nan')), torch.ones(1,64,64,4)]:
            vae = VAE()
            with self.assertRaises(ValueError): self.node.append(self.condition, vae, crop, 128)
            self.assertEqual(vae.images, [])
        with self.assertRaisesRegex(ValueError, 'video-first'):
            self.node.append([[self.tokens, {}]], VAE(), torch.rand(1,64,64,3), 128)

    def test_wrong_vae_rejected(self):
        vae = VAE(); vae.encode = lambda _: torch.zeros(1,16,8,8)
        with self.assertRaisesRegex(ValueError, 'H3 video VAE'):
            self.node.append(self.condition, vae, torch.rand(1,64,64,3), 128)

    def test_wrong_channel_count_or_spatial_grid_rejected_before_sampling(self):
        for shape in [(1,4,1,8,8), (1,24,1,4,8)]:
            vae = VAE(); vae.encode = lambda _, shape=shape: torch.zeros(shape)
            with self.assertRaisesRegex(ValueError, 'H3 video VAE'):
                self.node.append(self.condition, vae, torch.rand(1,64,64,3), 128)


if __name__ == '__main__': unittest.main()
