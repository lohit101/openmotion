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
    def test_head_detail_includes_old_jaw_outline_and_respects_protected_holes(self):
        import numpy as np
        image = np.zeros((640, 360, 3), np.uint8)
        permission = np.full((640, 360), 255, np.uint8)
        permission[180:200, 170:190] = 0
        face = {'bbox': [120, 140, 100, 120]}
        with patch.object(editor, 'detect', return_value=[face]):
            crop, mask, ref = editor.head_detail_inputs(image, image, permission, None)
        self.assertEqual(crop['resolution'], 1024)
        self.assertLessEqual(crop['x'] + crop['size'], 360)
        self.assertLessEqual(crop['y'] + crop['size'], 640)
        self.assertGreater(mask[250, 120], 240)  # Old cheek/jaw edges may be replaced.
        self.assertFalse(np.any(mask[180:200, 170:190]))
        self.assertFalse(np.any(mask[400:]))  # Physique and source garments stay outside this edit.
        self.assertGreater(ref.size, 0)

    def test_head_only_reuse_is_hash_bound_and_preparation_is_recoverable(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, 'detect', return_value=[{'bbox': [30, 30, 25, 30]}]):
            source, _, request, work = self.fixture(Path(temp))
            request.update(version='body-only-v5', face=request['reference'], bodyBase=request['source'], bodyBaseSHA256=editor.sha256(request['source']))
            request['settings'].update(model='qwen21', faceDetail=False)
            first = editor.prepare(request, work, None)
            self.assertIn('headEdit', first)
            self.assertEqual(editor.prepare(request, work, None), first)
            np.testing.assert_array_equal(cv2.imread(str(work / 'body-base.png')), source)
            request['bodyBaseSHA256'] = 'a' * 64
            with self.assertRaisesRegex(ValueError, 'saved body image changed'):
                editor.prepare(request, work, None)

    def test_staged_body_reference_uses_original_anatomy_on_square_without_stretching(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp:
            source, _, request, work = self.fixture(Path(temp))
            request['version'] = 'body-only-v3'; request['face'] = request['reference']
            request['settings'].update(model='qwen21', faceDetail=False, qwenHeadRefine=False)
            face = {'bbox': [30, 20, 20, 25]}
            with patch.object(editor, 'detect', return_value=[face]): editor.prepare(request, work, None)
            square = cv2.imread(str(work / 'body-reference-canvas.png')); reference = cv2.imread(request['reference'])
            self.assertEqual(square.shape, (117, 117, 3))
            np.testing.assert_array_equal(square[:, 12:105], reference)
            self.assertTrue(np.all(square[:, :12] == 255))
            mask = cv2.imread(str(work / 'face-refine-mask.png'), 0)
            working = cv2.imread(str(work / 'working-mask.png'), 0)
            self.assertTrue(np.any(mask > 64)); self.assertTrue(np.all(mask <= working))
            np.testing.assert_array_equal(cv2.imread(str(work / 'original.png')), source)

    def test_body_only_selected_views_keep_originals_and_freeze_crop_pixels(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, 'detect', side_effect=AssertionError('No implicit reference selection')):
            source, _, request, work = self.fixture(Path(temp))
            request['version'] = 'body-only-v2'; request['face'] = request['reference']
            request['settings'].update(model='qwen21', faceDetail=False, bodyReferenceView={'assetId': 'body', 'x': 10, 'y': 20, 'width': 64, 'height': 64}, faceReferenceView={'assetId': 'face', 'x': 20, 'y': 30, 'width': 64, 'height': 64})
            reference = cv2.imread(request['reference'])
            editor.prepare(request, work, None)
            np.testing.assert_array_equal(cv2.imread(str(work / 'identity.png')), reference[20:84, 10:74])
            np.testing.assert_array_equal(cv2.imread(str(work / 'face.png')), reference[30:94, 20:84])
            np.testing.assert_array_equal(cv2.imread(request['reference']), reference)
            np.testing.assert_array_equal(cv2.imread(str(work / 'original.png')), source)
            request['settings']['faceReferenceView']['x'] += 1
            with self.assertRaisesRegex(ValueError, 'Saved image inputs changed'):
                editor.prepare(request, work, None)

    def test_reference_views_reject_out_of_bounds_tiny_or_fractional_crops(self):
        import numpy as np
        image = np.zeros((160, 128, 3), np.uint8)
        for view in [dict(x=100, y=0, width=32, height=40), dict(x=0, y=-1, width=32, height=40), dict(x=0, y=0, width=31, height=40), dict(x=0.5, y=0, width=32, height=40)]:
            with self.assertRaises(ValueError): editor.reference_view(image, view)

    def test_body_only_preserves_three_reference_roles_without_implicit_face_selection(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, 'detect', side_effect=AssertionError('Do not silently choose a face from a sheet')):
            source, _, request, work = self.fixture(Path(temp))
            request['version'] = 'body-only-v1'
            request['face'] = request['reference']
            request['settings'].update(model='qwen21', faceDetail=False, qwenHeadRefine=False, maskExpand=12, maskFillHoles=False)
            prepared = editor.prepare(request, work, None)
            self.assertTrue(prepared['hasFace'])
            self.assertTrue((work / 'face.png').is_file())
            self.assertTrue((work / 'working-mask.png').is_file())
            np.testing.assert_array_equal(cv2.imread(str(work / 'original.png')), source)
            self.assertEqual(editor.prepare(request, work, None), prepared)
            cv2.imwrite(str(Path(request['face'])), np.zeros_like(source))
            with self.assertRaisesRegex(ValueError, 'Saved image inputs changed'):
                editor.prepare(request, work, None)

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

    def test_local_anchor_conditions_target_without_replacing_immutable_original(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, 'detect', return_value=[]):
            source, _, request, work = self.fixture(Path(temp))
            request['version'] = 'scene-anchor-v7'
            request['settings'].update(model='qwen21', faceDetail=False, localIdentity=True)
            anchor = np.full_like(source, 77)
            def identity(reference, target, output, mask):
                cv2.imwrite(str(output), anchor)
                Path(output).with_suffix('.identity.json').write_text('{}')
            with patch.object(editor, 'run_local_identity', side_effect=identity) as run:
                editor.prepare(request, work, None)
                editor.prepare(request, work, None)
                self.assertEqual(run.call_count, 1)
            np.testing.assert_array_equal(cv2.imread(str(work / 'original.png')), source)
            np.testing.assert_array_equal(cv2.imread(str(work / 'target.png'))[5:122, 1:94], anchor)
            marker = json.loads((work / 'image-inputs.json').read_text())
            self.assertIn('identity-anchored-target.png', marker['outputs'])

    def test_layout_guide_removes_original_face_and_keeps_protected_scene_contours(self):
        import cv2
        import numpy as np
        source = np.zeros((160, 128, 3), np.uint8)
        cv2.rectangle(source, (12, 16), (115, 145), (255, 255, 255), 2)
        cv2.line(source, (42, 62), (83, 62), (255, 255, 255), 3)
        mask = np.zeros((160, 128), np.uint8); mask[30:155, 30:99] = 255
        geometry = {'contentWidth': 128, 'contentHeight': 160, 'width': 128, 'height': 160, 'x': 0, 'y': 0}
        with patch.object(editor, 'detect', return_value=[{'bbox': [36, 40, 56, 70]}]):
            old = editor.source_structure(source, geometry, None)
            guide = editor.source_structure(source, geometry, None, mask)
        self.assertFalse(np.any(guide[58:66, 48:80]))
        np.testing.assert_array_equal(guide[mask == 0], old[mask == 0])
        self.assertTrue(np.any(guide[mask > 0]))

    def test_body_reference_square_canvas_keeps_aspect_and_immutable_anatomy_pixels(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, 'detect', return_value=[]):
            _, _, request, work = self.fixture(Path(temp))
            reference = cv2.imread(request['reference'])
            request['version'] = 'body-identity-v1'
            request['settings'].update(model='qwen21', faceDetail=False, qwenHeadRefine=False, qwenNormalizeReference=True)
            editor.prepare(request, work, None)
            canvas = cv2.imread(str(work / 'body-reference-canvas.png'))
            self.assertEqual(canvas.shape, (1024, 1024, 3))
            width = round(reference.shape[1] / reference.shape[0] * 1024)
            left = (1024 - width) // 2
            expected = cv2.resize(reference, (width, 1024), interpolation=cv2.INTER_AREA)
            np.testing.assert_array_equal(canvas[:, left:left + width], expected)
            self.assertTrue(np.all(canvas[:, :left] == 240))
            self.assertTrue((work / 'working-mask.png').is_file())
            self.assertIn('body-reference-canvas.png', json.loads((work / 'image-inputs.json').read_text())['outputs'])

    def test_scene_integration_preserves_protected_pixels_without_translating_actor(self):
        import cv2
        import numpy as np
        source = np.full((160, 128, 3), 100, np.uint8)
        raw = np.full_like(source, 150)
        cv2.rectangle(raw, (45, 55), (75, 95), (10, 30, 60), -1)
        mask = np.zeros((160, 128), np.uint8); mask[25:135, 25:103] = 255
        result = editor.integrate_scene(source, raw, mask)
        np.testing.assert_array_equal(result[mask == 0], source[mask == 0])
        yy, xx = np.where(result[:, :, 0] < 45)
        self.assertAlmostEqual(float(xx.mean()), 60, delta=1)
        self.assertAlmostEqual(float(yy.mean()), 75, delta=1)

    def test_native_edit_allowance_expands_outer_boundary_and_preserves_protected_holes(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            source, mask, request, work = self.fixture(Path(temp))
            mask[48:60, 43:53] = 0
            cv2.imwrite(request["mask"], mask)
            request["version"] = "native-mask-v1"
            request["settings"].update(model="qwen21", faceDetail=False, maskExpand=6, feather=4)
            editor.prepare(request, work, None)
            effective = cv2.imread(str(work / "edit-mask.png"), 0)
            self.assertGreater(effective[40, 22], 0)
            self.assertFalse(np.any(effective[48:60, 43:53]))
            self.assertFalse(np.any(effective[:, :18]))
            self.assertTrue((work / "working-mask.png").is_file())
            cv2.imwrite(str(work / "gpu-result.png"), source)
            editor.finish(request, work, None)
            np.testing.assert_array_equal(cv2.imread(str(work / "final.png"))[effective == 0], source[effective == 0])

        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            _, mask, request, work = self.fixture(Path(temp))
            request["version"] = "masked-latent-v4"
            request["settings"]["maskExpand"] = 6
            editor.prepare(request, work, None)
            historical = cv2.imread(str(work / "edit-mask.png"), 0)
            self.assertFalse(np.any(historical[mask == 0]))

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

    def test_native_hole_fill_is_explicit_and_can_work_without_outer_expansion(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[]):
            _, mask, request, work = self.fixture(Path(temp))
            mask[48:60, 43:53] = 0
            cv2.imwrite(request["mask"], mask)
            request["version"] = "native-scene-v1"
            request["settings"].update(model="qwen21", faceDetail=False, maskExpand=0, maskFillHoles=True)
            editor.prepare(request, work, None)
            effective = cv2.imread(str(work / "edit-mask.png"), 0)
            self.assertTrue(np.all(effective[48:60, 43:53] == 255))
            self.assertFalse(np.any(effective[:, :25]))

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

    def test_qwen_review_ignores_a_saved_manual_face_that_did_not_condition_the_model(self):
        import cv2
        import numpy as np
        face = {"bbox": [30, 20, 20, 28], "confidence": .95}
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[face]):
            source, _, request, work = self.fixture(Path(temp))
            manual = Path(temp) / "unused-face.png"
            cv2.imwrite(str(manual), np.full_like(source, 77))
            request["face"] = str(manual)
            request["settings"].update(model="qwen21", faceDetail=False, identityRefine=False)
            editor.prepare(request, work, "fixture detector")
            cv2.imwrite(str(work / "gpu-result.png"), source)
            editor.finish(request, work, "fixture detector")
            np.testing.assert_array_equal(cv2.imread(str(work / "reference-face.png")), editor.face_crop(source[::-1], face))

    def test_mask_gap_repair_closes_small_enclosed_holes_without_growing_the_boundary(self):
        import numpy as np
        mask = np.zeros((200, 160), np.uint8)
        mask[10:190, 10:150] = 255
        mask[30:33, 30:33] = 0
        mask[29:34, 29] = 80
        mask[29:34, 28] = 220
        mask[60:90, 60:90] = 0  # Large intentional occlusion stays protected.
        repaired, closed = editor.repair_small_mask_gaps(mask)
        self.assertEqual(closed, 1)
        self.assertTrue(np.all(repaired[30:33, 30:33] == 255))
        self.assertTrue(np.all(repaired[29:34, 29] == 255))
        self.assertTrue(np.all(repaired[29:34, 28] == 255))
        self.assertFalse(np.any(repaired[60:90, 60:90]))
        self.assertFalse(np.any(repaired[:10]))
        self.assertFalse(np.any(repaired[:, :10]))

    def test_source_anchored_preparation_has_immutable_geometry_and_separate_head_body_masks(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[{"bbox": [30, 20, 20, 28], "confidence": .95}]):
            _, _, request, work = self.fixture(Path(temp))
            request["version"] = "scene-anchor-v1"
            request["settings"].update(model="qwen21", faceDetail=False, qwenHeadRefine=True, repairMaskGaps=True)
            report = editor.prepare(request, work, "fixture detector")
            self.assertTrue(report["hasFace"])
            body = cv2.imread(str(work / "body-mask.png"), 0)
            head = cv2.imread(str(work / "face-refine-mask.png"), 0)
            full = cv2.imread(str(work / "working-mask.png"), 0)
            self.assertEqual(body.shape, (128, 96))
            self.assertTrue(np.all(body <= full))
            self.assertTrue(np.all(head <= full))
            self.assertEqual(body[39, 41], 0)
            structure = cv2.imread(str(work / "source-structure.png"))
            self.assertEqual(structure.shape, (128, 96, 3))
            self.assertTrue(np.any(structure > 0))
            self.assertEqual(editor.prepare(request, work, "fixture detector"), report)
            cv2.imwrite(str(work / "source-structure.png"), np.zeros_like(structure))
            with self.assertRaisesRegex(ValueError, "Saved image inputs changed"):
                editor.prepare(request, work, "fixture detector")

    def test_new_head_preparation_keeps_generated_identity_instead_of_reinserting_source_face(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, "detect", return_value=[{"bbox": [30, 20, 20, 28], "confidence": .95}]):
            _, _, request, work = self.fixture(Path(temp))
            request["version"] = "scene-anchor-v3"
            request["settings"].update(model="qwen21", faceDetail=False, qwenHeadRefine=True, repairMaskGaps=True)
            editor.prepare(request, work, "fixture detector")
            body = cv2.imread(str(work / "body-mask.png"), 0)
            full = cv2.imread(str(work / "working-mask.png"), 0)
            np.testing.assert_array_equal(body, full)
            self.assertGreater(int(body[39, 41]), 0)


if __name__ == "__main__":
    unittest.main()
