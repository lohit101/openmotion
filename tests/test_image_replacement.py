"""Pixel preservation and immutable-input checks; no inference or quality claims."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import image_replacement as editor


@unittest.skipUnless(importlib.util.find_spec("cv2"), "Run in .local/geometry-venv for CPU image checks")
class ImageReplacementTests(unittest.TestCase):
    def fixture(self, folder):
        import cv2
        import numpy as np
        source = np.arange(117 * 93 * 3, dtype=np.uint8).reshape(117, 93, 3)
        mask = np.zeros((117, 93), np.uint8)
        mask[15:95, 25:70] = 255
        for name, data in [("source", source), ("reference", source[::-1]), ("mask", mask)]:
            cv2.imwrite(str(folder / (name + ".png")), data)
        request = {"source": str(folder / "source.png"), "reference": str(folder / "reference.png"), "mask": str(folder / "mask.png"), "face": None,
                   "settings": {"faceDetail": True, "protectBackground": True, "feather": 4, "seed": 42},
                   "geometry": {"width": 96, "height": 128, "contentWidth": 93, "contentHeight": 117, "x": 1, "y": 5, "outputWidth": 93, "outputHeight": 117}}
        work = folder / "job"
        work.mkdir()
        return source, mask, request, work

    def test_padding_reference_crop_fallback_and_exact_background_pixels(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            source, mask, request, work = self.fixture(Path(temp))
            report = editor.prepare(request, work, None)
            self.assertFalse(report["hasFace"])
            self.assertTrue(report["warnings"])
            padded = cv2.imread(str(work / "target.png"))
            np.testing.assert_array_equal(padded[5:122, 1:94], source)
            prepared_mask = cv2.imread(str(work / "edit-mask.png"), 0)
            self.assertFalse(np.any(prepared_mask[mask == 0]))
            cv2.imwrite(str(work / "gpu-result.png"), np.full_like(source, 142))
            review = editor.finish(request, work, None)
            final = cv2.imread(str(work / "final.png"))
            np.testing.assert_array_equal(final[mask == 0], source[mask == 0])
            self.assertEqual(review["outsideMaskMaxDifference"], 0)
            self.assertTrue(review["backgroundProtected"])
            self.assertEqual(review["status"], "warning")

    def test_saved_conditioning_is_reused_and_tampering_is_rejected(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            _, _, request, work = self.fixture(Path(temp))
            first = editor.prepare(request, work, None)
            self.assertEqual(editor.prepare(request, work, None), first)
            cv2.imwrite(str(work / "target.png"), np.zeros((128, 96, 3), np.uint8))
            with self.assertRaisesRegex(ValueError, "Saved image inputs changed"):
                editor.prepare(request, work, None)

    def test_empty_mask_and_wrong_output_dimensions_cannot_pass(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            source, _, request, work = self.fixture(Path(temp))
            cv2.imwrite(request["mask"], np.zeros(source.shape[:2], np.uint8))
            with self.assertRaisesRegex(ValueError, "mask is empty"):
                editor.prepare(request, work, None)
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            _, _, request, work = self.fixture(Path(temp))
            editor.prepare(request, work, None)
            cv2.imwrite(str(work / "gpu-result.png"), np.zeros((64, 64, 3), np.uint8))
            with self.assertRaisesRegex(ValueError, "unexpected dimensions"):
                editor.finish(request, work, None)

    def test_clear_face_crop_is_real_and_not_guessed_from_image_center(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[{"bbox": [30, 20, 20, 28], "confidence": .95}]):
            _, _, request, work = self.fixture(Path(temp))
            result = editor.prepare(request, work, "fixture detector")
            self.assertTrue(result["hasFace"])
            self.assertTrue((work / "face.png").is_file())

    def test_native_sampling_mask_uses_the_same_scale_and_padding_as_the_target(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            _, _, request, work = self.fixture(Path(temp))
            request["version"] = "masked-latent-v2"
            editor.prepare(request, work, None)
            working = cv2.imread(str(work / "working-mask.png"), 0)
            self.assertEqual(working.shape, (128, 96))
            self.assertFalse(np.any(working[:5]))
            self.assertFalse(np.any(working[:, :1]))
            native = cv2.imread(str(work / "edit-mask.png"), 0)
            np.testing.assert_array_equal(working[5:122, 1:94], native)


if __name__ == "__main__":
    unittest.main()
