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

    def test_refinement_face_area_is_aligned_and_never_expands_the_selected_edit(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[{"bbox": [30, 20, 20, 28], "confidence": .95}]):
            _, _, request, work = self.fixture(Path(temp))
            request["version"] = "masked-latent-v3"
            request["settings"]["identityRefine"] = True
            editor.prepare(request, work, "fixture detector")
            face = cv2.imread(str(work / "face-refine-mask.png"), 0)
            mask = cv2.imread(str(work / "working-mask.png"), 0)
            self.assertEqual(face.shape, mask.shape)
            self.assertTrue(np.any(face > 64))
            self.assertTrue(np.all(face <= mask))
            self.assertEqual(editor.prepare(request, work, "fixture detector")["hasFace"], True)

    def test_missing_identity_face_fails_before_paid_inference(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            _, _, request, work = self.fixture(Path(temp))
            request["version"] = "masked-latent-v3"
            request["settings"]["identityRefine"] = True
            with self.assertRaisesRegex(ValueError, "clear reference face"):
                editor.prepare(request, work, None)

    def test_face_review_uses_the_manual_closeup_that_actually_conditioned_the_model(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[{"bbox": [30, 20, 20, 28], "confidence": .95}]):
            source, _, request, work = self.fixture(Path(temp))
            manual = Path(temp) / "manual.png"
            cv2.imwrite(str(manual), np.full_like(source, 77))
            request["face"] = str(manual)
            editor.prepare(request, work, "fixture detector")
            cv2.imwrite(str(work / "gpu-result.png"), source)
            editor.finish(request, work, "fixture detector")
            self.assertTrue(np.all(cv2.imread(str(work / "reference-face.png")) == 77))

    def test_closeup_target_crops_distant_reference_framing_without_stretching_or_changing_pixels(self):
        import numpy as np
        source = np.zeros((300, 200, 3), np.uint8)
        reference = np.arange(600 * 400 * 3, dtype=np.uint8).reshape(600, 400, 3)
        faces = [[{"bbox": [40, 60, 100, 140], "confidence": .95}], [{"bbox": [180, 70, 50, 70], "confidence": .95}]]
        with patch.object(editor, "detect", side_effect=faces):
            result, cropped = editor.reference_field_of_view(reference, source, "fixture detector")
        self.assertTrue(cropped)
        self.assertEqual(result.shape, (150, 100, 3))
        np.testing.assert_array_equal(result, reference[40:190, 160:260])
        with patch.object(editor, "detect", return_value=[]):
            result, cropped = editor.reference_field_of_view(reference, source, None)
        self.assertFalse(cropped)
        self.assertIs(result, reference)


if __name__ == "__main__":
    unittest.main()
