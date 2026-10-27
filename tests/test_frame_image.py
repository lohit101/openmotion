"""Local framing must preserve the accepted subject and protected scene pixels."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import frame_image


@unittest.skipUnless(importlib.util.find_spec('cv2'), 'Requires the existing local OpenCV runtime')
class FramingTests(unittest.TestCase):
    def test_uniform_transform_protected_pixels_and_immutable_parent(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = np.full((120, 80, 3), [40, 80, 120], np.uint8)
            image = source.copy(); image[30:110, 25:60] = [90, 60, 30]
            matte = np.zeros((120, 80), np.uint8); matte[30:110, 25:60] = 255
            allowance = cv2.dilate(matte, np.ones((5, 5), np.uint8))
            for name, data in [('source', source), ('image', image), ('matte', matte), ('allowance', allowance)]:
                cv2.imwrite(str(root / (name + '.png')), data)
            files = [root / (n + '.png') for n in ['source', 'image', 'matte', 'allowance']]
            before = [p.read_bytes() for p in files]
            face = {'bbox': [28, 32, 20, 24]}
            with patch('image_replacement.detect', return_value=[face]):
                result = frame_image.frame(*files, root / 'result', None, 1.25)
                output = cv2.imread(str(root / 'result/final.png'))
                mask = cv2.imread(str(root / 'result/edit-mask.png'), 0)
                np.testing.assert_array_equal(output[mask == 0], source[mask == 0])
                self.assertEqual([p.read_bytes() for p in files], before)
                self.assertFalse(result['paidInference'])
                self.assertEqual(result['matrix'][0][0], result['matrix'][1][1])
                self.assertEqual(result['matrix'][0][1], 0)
                with self.assertRaisesRegex(ValueError, 'immutable'):
                    frame_image.frame(*files, root / 'result', None, 1.25)

    def test_rejects_unknown_faces_before_writing(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); file = root / 'input.png'
            cv2.imwrite(str(file), np.zeros((40, 40, 3), np.uint8))
            with patch('image_replacement.detect', return_value=[]):
                with self.assertRaisesRegex(ValueError, 'unambiguous'):
                    frame_image.frame(file, file, file, file, root / 'result', None, 1.2)
            self.assertFalse((root / 'result').exists())


if __name__ == '__main__':
    unittest.main()
