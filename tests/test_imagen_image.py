"""CPU-only whole-canvas preparation and unchanged native output recovery."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from imagen_image import prepare, finish, reference
from reference_geometry import dependencies, atomic_png


class WholeImageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.cv2, self.np = dependencies()
        self.pixels = self.np.random.default_rng(314).integers(0, 256, (180, 100, 3), dtype=self.np.uint8)
        self.source = self.root / 'input.png'; atomic_png(self.source, self.pixels)
        self.geometry = {'width': 128, 'height': 224, 'contentWidth': 120, 'contentHeight': 216, 'x': 4, 'y': 4, 'outputWidth': 120, 'outputHeight': 216}
        self.request = {'version': 'imagen-v1', 'settings': {'workflow': 'body-only'}, 'geometry': self.geometry, 'source': str(self.source), 'reference': str(self.source), 'face': str(self.source)}

    def tearDown(self):
        self.tmp.cleanup()

    def test_whole_canvas_is_editable_without_a_painted_region_or_new_weights(self):
        folder = self.root / 'edit'
        result = prepare(self.request, folder)
        self.assertTrue(result['hasFace'])
        mask = self.cv2.imread(str(folder / 'edit-mask.png'), self.cv2.IMREAD_GRAYSCALE)
        self.assertEqual(mask.shape, (216, 120)); self.assertTrue((mask == 255).all())
        image = self.cv2.imread(str(folder / 'target.png'))
        self.assertEqual(image.shape[:2], (224, 128))
        expected = self.cv2.resize(self.pixels, (120, 216), interpolation=self.cv2.INTER_LANCZOS4)
        self.np.testing.assert_array_equal(image[4:220, 4:124], expected)
        permission = json.loads((folder / 'imagen-permission.json').read_text())
        self.assertEqual(permission['editable'], 'whole-image'); self.assertFalse(permission['manualMask'])

    def test_reference_view_crops_the_bound_sheet_without_repainting_it(self):
        crop = reference(self.source, {'x': 5, 'y': 2, 'width': 40, 'height': 60})
        self.np.testing.assert_array_equal(crop[:60, :40], self.pixels[2:62, 5:45])
        with self.assertRaisesRegex(ValueError, 'outside'):
            reference(self.source, {'x': 90, 'y': 0, 'width': 40, 'height': 60})

    def test_text_to_image_has_no_hidden_reference_upload(self):
        request = {**self.request, 'settings': {'workflow': 'text-to-image'}, 'source': None, 'reference': None, 'face': None}
        folder = self.root / 'text'; prepare(request, folder)
        self.assertFalse((folder / 'target.png').exists()); self.assertFalse((folder / 'identity.png').exists())
        self.assertTrue((folder / 'edit-mask.png').exists())

    def test_transparent_standalone_garments_are_seen_on_white_not_black(self):
        rgba = self.np.zeros((64, 64, 4), dtype=self.np.uint8)
        rgba[16:48, 16:48] = [10, 100, 200, 255]
        file = self.root / 'garment.png'; atomic_png(file, rgba)
        result = reference(file)
        self.np.testing.assert_array_equal(result[0, 0], [255, 255, 255])
        self.np.testing.assert_array_equal(result[32, 32], [10, 100, 200])

    def test_a_narrow_sheet_view_is_padded_without_stretching_anatomy(self):
        crop = reference(self.source, {'x': 5, 'y': 2, 'width': 10, 'height': 60})
        self.np.testing.assert_array_equal(crop[:60, :10], self.pixels[2:62, 5:15])

    def test_finalization_keeps_every_native_pixel_including_background_and_skin_detail(self):
        folder = self.root / 'output'; folder.mkdir()
        pixels = self.np.random.default_rng(42).integers(0, 256, (216, 120, 3), dtype=self.np.uint8)
        atomic_png(folder / 'gpu-result.png', pixels)
        result = finish(self.request, folder)
        self.np.testing.assert_array_equal(self.cv2.imread(str(folder / 'final.png')), pixels)
        self.assertFalse(result['backgroundProtected']); self.assertIsNone(result['outsideMaskMaxDifference'])
        finish(self.request, folder)  # Local recovery neither samples nor filters.
        self.np.testing.assert_array_equal(self.cv2.imread(str(folder / 'final.png')), pixels)

    def test_dimension_mismatch_keeps_paid_output_and_refuses_a_silent_resize(self):
        folder = self.root / 'bad'; folder.mkdir(); atomic_png(folder / 'gpu-result.png', self.pixels)
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            finish(self.request, folder)
        self.assertTrue((folder / 'gpu-result.png').is_file()); self.assertFalse((folder / 'final.png').exists())


if __name__ == '__main__':
    unittest.main()
