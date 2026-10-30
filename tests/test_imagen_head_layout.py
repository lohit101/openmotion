"""Source-derived cues and receipt preservation, without inference."""
from pathlib import Path
import json
import math
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import imagen_head_layout as layout
import image_replacement as editor
import test_image_replacement


class SourceHeadLayoutTests(unittest.TestCase):
    def face(self):
        return {'bbox': [10, 10, 80, 90], 'landmarks': [[30, 35], [70, 25], [72, 55], [40, 75], [70, 75]]}

    def test_roll_and_turn_are_source_derived_not_donor_pose(self):
        result = layout.describe([self.face()], 120, 120)
        self.assertEqual(result['status'], 'available')
        self.assertAlmostEqual(result['rollDegrees'], math.degrees(math.atan2(-10, 40)))
        self.assertGreater(result['noseOffset'], .18)
        self.assertEqual(result['bbox'], [10, 10, 80, 90])

    def test_tilting_a_frontal_face_does_not_invent_a_side_turn(self):
        face = self.face(); face['landmarks'][2] = [55, 50]
        self.assertAlmostEqual(layout.describe([face], 120, 120)['noseOffset'], 0)

    def test_ambiguous_and_invalid_geometry_never_selects_an_arbitrary_face(self):
        self.assertEqual(layout.describe([], 120, 120)['status'], 'unavailable')
        self.assertEqual(layout.describe([self.face(), self.face()], 120, 120)['status'], 'unavailable')
        self.assertEqual(layout.describe([{'bbox': [0, 0, float('nan'), 1]}], 120, 120)['status'], 'unavailable')

    def test_missing_landmarks_keep_scale_check_without_invented_pose(self):
        result = layout.describe([{'bbox': [10, 10, 80, 90]}], 120, 120)
        self.assertEqual(result['status'], 'available'); self.assertIsNone(result['rollDegrees']); self.assertIsNone(result['noseOffset'])

    def test_small_faces_do_not_produce_unreliable_turn_instructions(self):
        face = self.face(); face['bbox'] = [10, 10, 20, 25]
        value = layout.describe([face], 120, 120)
        self.assertIsNone(value['rollDegrees']); self.assertIsNone(value['noseOffset'])

    def test_comparison_detects_size_and_pose_regression_without_identity_score(self):
        a = layout.describe([self.face()], 120, 120)
        face = self.face(); face['bbox'] = [30, 25, 60, 70]; face['landmarks'] = [[40, 45], [65, 45], [52, 60], [43, 75], [62, 75]]
        b = layout.describe([face], 120, 120)
        metrics = layout.compare(a, b)
        self.assertLess(metrics['faceSizeRatio'], .8); self.assertGreater(metrics['rollDifferenceDegrees'], 8)
        self.assertGreater(metrics['noseOffsetDifference'], .18); self.assertNotIn('identity', metrics)

    def test_new_preparation_freezes_layout_and_reuses_original_pixels(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp, patch.object(editor, 'detect', return_value=[self.face()]):
            source, _, request, folder = test_image_replacement.ImageReplacementTests().fixture(Path(temp))
            request.update(version='body-only-v8', face=request['reference'])
            request['settings'].update(model='qwen21', faceDetail=False)
            prepared = editor.prepare(request, folder, None)
            self.assertEqual(prepared['headLayout']['status'], 'available')
            self.assertEqual(editor.prepare(request, folder, None), prepared)
            np.testing.assert_array_equal(cv2.imread(str(folder / 'original.png')), source)
            receipt = json.loads((folder / 'image-inputs.json').read_text())
            self.assertIn('source-head-layout.json', receipt['outputs'])
            (folder / 'source-head-layout.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'Saved image inputs changed'):
                editor.prepare(request, folder, None)

    def test_finalization_reports_pose_regression_and_rejects_changed_layout_receipt(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp:
            source, _, request, folder = test_image_replacement.ImageReplacementTests().fixture(Path(temp))
            request.update(version='body-only-v8', face=request['reference'])
            request['settings'].update(model='qwen21', faceDetail=False)
            with patch.object(editor, 'detect', return_value=[self.face()]): editor.prepare(request, folder, None)
            cv2.imwrite(str(folder / 'gpu-result.png'), np.full_like(source, 99))
            wrong = self.face(); wrong['bbox'] = [30, 25, 60, 70]; wrong['landmarks'] = [[40, 45], [65, 45], [52, 60], [43, 75], [62, 75]]
            with patch.object(editor, 'detect', side_effect=[[self.face()], [self.face()], [wrong]]):
                review = editor.finish(request, folder, None)
            self.assertGreater(review['headLayout']['rollDifferenceDegrees'], 8)
            self.assertTrue(any('tilt or turn' in warning for warning in review['warnings']))
            self.assertEqual(review['outsideMaskMaxDifference'], 0)
            before = editor.sha256(folder / 'final.png')
            (folder / 'source-head-layout.json').write_text('{}')
            with self.assertRaisesRegex(ValueError, 'saved source-head layout changed'):
                editor.finish(request, folder, None)
            self.assertEqual(editor.sha256(folder / 'final.png'), before)


if __name__ == '__main__':
    unittest.main()
