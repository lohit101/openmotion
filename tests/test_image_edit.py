"""CPU contracts only; these fixtures do not measure model output quality."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from image_edit import process
from reference_geometry import dependencies
cv2, np = dependencies()

def save(file, size, color):
    colors = {"red": (0, 0, 255), "green": (0, 128, 0), "blue": (255, 0, 0), "yellow": (0, 255, 255)}
    pixels = np.zeros((size[1], size[0], 3), dtype=np.uint8)
    pixels[:] = colors.get(color, (0, 0, 0))
    cv2.imwrite(str(file), pixels)


class ImageEditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.folder = self.root / 'job'
        self.folder.mkdir()
        self.refs = []
        for i, color in enumerate(('red', 'green', 'blue')):
            file = self.root / f'{i}.png'
            save(file, (64 + i * 32, 96), color)
            self.refs.append({'id': str(i), 'path': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'size': file.stat().st_size, 'width': 64 + i * 32, 'height': 96})
        self.request = {'version': 'image-edit-2511-v1', 'references': self.refs, 'settings': {'format': 'png', 'prompt': '原样保留  \n exact text'}, 'geometry': {'width': 128, 'height': 96}}

    def tearDown(self):
        self.temp.cleanup()

    def native(self):
        # Many colors rather than a constant fill: catches resizes/composites.
        x = np.arange(128 * 96).reshape((96, 128))
        image = np.stack(((x * 11) % 256, (x * 37) % 256, (x * 89) % 256), axis=2).astype(np.uint8)
        cv2.imwrite(str(self.folder / 'gpu-result.png'), image)

    def test_complete_references_preserve_order_dimensions_pixels_and_prompt(self):
        process('prepare', self.request, self.folder)
        for i, ref in enumerate(self.refs, 1):
            prepared = cv2.imread(str(self.folder / f'edit-reference-{i}.png'))
            original = cv2.imread(ref['path'])
            self.assertTrue(np.array_equal(prepared, original))
        receipt = json.loads((self.folder / 'image-edit-inputs.json').read_text())
        self.assertEqual(receipt['settings']['prompt'], self.request['settings']['prompt'])

    def test_png_export_is_byte_identical_to_native_and_retry_is_local(self):
        process('prepare', self.request, self.folder)
        self.native()
        native = (self.folder / 'gpu-result.png').read_bytes()
        for _ in range(2):
            process('finish', self.request, self.folder)
            self.assertEqual(native, (self.folder / 'final.png').read_bytes())

    def test_jpeg_export_keeps_native_png_and_canvas(self):
        self.request['settings']['format'] = 'jpeg'
        process('prepare', self.request, self.folder)
        self.native()
        native = (self.folder / 'gpu-result.png').read_bytes()
        process('finish', self.request, self.folder)
        final = cv2.imread(str(self.folder / 'final.jpg'))
        self.assertEqual(final.shape[:2], (96, 128))
        self.assertTrue((self.folder / 'final.jpg').read_bytes().startswith(b'\xff\xd8'))
        self.assertEqual(native, (self.folder / 'gpu-result.png').read_bytes())

    def test_changed_original_is_rejected_before_upload(self):
        save(self.refs[0]['path'], (64, 96), 'yellow')
        with self.assertRaisesRegex(ValueError, 'changed'):
            process('prepare', self.request, self.folder)

    def test_changed_recipe_order_or_prepared_pixels_preserves_paid_result(self):
        process('prepare', self.request, self.folder)
        self.native()
        original = (self.folder / 'gpu-result.png').read_bytes()
        for key in ('prompt', 'order', 'pixels'):
            request = copy.deepcopy(self.request)
            if key == 'prompt':
                request['settings']['prompt'] += ' changed'
            elif key == 'order':
                request['references'].reverse()
            else:
                save(self.folder / 'edit-reference-1.png', (64, 96), 'yellow')
            with self.assertRaisesRegex(ValueError, 'changed'):
                process('finish', request, self.folder)
            self.assertEqual(original, (self.folder / 'gpu-result.png').read_bytes())

    def test_wrong_native_canvas_is_preserved_without_upsizing(self):
        process('prepare', self.request, self.folder)
        save(self.folder / 'gpu-result.png', (64, 64), 'black')
        with self.assertRaisesRegex(ValueError, 'without resizing'):
            process('finish', self.request, self.folder)
        self.assertFalse((self.folder / 'final.png').exists())

    def test_alpha_is_flattened_on_white_without_a_black_border(self):
        file = self.root / 'alpha.png'
        cv2.imwrite(str(file), np.zeros((96, 64, 4), dtype=np.uint8))
        self.request['references'] = [{'id': 'alpha', 'path': str(file), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'size': file.stat().st_size, 'width': 64, 'height': 96}]
        process('prepare', self.request, self.folder)
        prepared = cv2.imread(str(self.folder / 'edit-reference-1.png'))
        self.assertEqual(tuple(prepared[0, 0]), (255, 255, 255))


class ImageEditQwen21Tests(ImageEditTests):
    def setUp(self):
        super().setUp()
        self.request['version'] = 'image-edit-qwen21-v1'
        self.request['settings'].update(consistency=True, bfs=True)

    def test_complete_references_preserve_order_dimensions_pixels_and_prompt(self):
        source_bytes = Path(self.refs[0]['path']).read_bytes()
        process('prepare', self.request, self.folder)
        first = cv2.imread(str(self.folder / 'edit-reference-1.png'))
        self.assertEqual(first.shape, (96, 128, 3))
        self.assertTrue(np.array_equal(first[:, 32:96], cv2.imread(self.refs[0]['path'])))
        self.assertTrue(np.all(first[:, :32] == 255))
        self.assertTrue(np.all(first[:, 96:] == 255))
        self.assertEqual(Path(self.refs[0]['path']).read_bytes(), source_bytes)
        for i, ref in enumerate(self.refs[1:], 2):
            self.assertTrue(np.array_equal(cv2.imread(str(self.folder / f'edit-reference-{i}.png')), cv2.imread(ref['path'])))
        receipt = json.loads((self.folder / 'image-edit-inputs.json').read_text())
        self.assertEqual([r['id'] for r in receipt['references']], [r['id'] for r in self.refs])
        self.assertEqual((receipt['references'][0]['width'], receipt['references'][0]['height']), (128, 96))
        self.assertEqual(receipt['settings']['prompt'], self.request['settings']['prompt'])

    def test_selected_native_canvas_resizes_the_complete_target_with_equal_axis_scale(self):
        self.request['geometry'] = {'width': 128, 'height': 192}
        process('prepare', self.request, self.folder)
        first = cv2.imread(str(self.folder / 'edit-reference-1.png'))
        self.assertEqual(first.shape, (192, 128, 3))
        self.assertTrue(np.all(first == (0, 0, 255)))

    def test_changed_lora_recipe_preserves_the_native_result(self):
        process('prepare', self.request, self.folder)
        self.native()
        original = (self.folder / 'gpu-result.png').read_bytes()
        self.request['settings']['bfs'] = False
        with self.assertRaisesRegex(ValueError, 'changed'):
            process('finish', self.request, self.folder)
        self.assertEqual((self.folder / 'gpu-result.png').read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
