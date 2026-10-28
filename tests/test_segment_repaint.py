"""CPU-only raw appearance, face permission and immutable repaint input tests."""
import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import segment_repaint as repaint


@unittest.skipUnless(importlib.util.find_spec('cv2'), 'Run in the local geometry environment')
class SegmentRepaintTests(unittest.TestCase):
    def anchor(self, folder, overlap=5, extra=True):
        import numpy as np
        skip = 124 - overlap
        expected = {'jobId': 'video', 'width': 64, 'height': 96, 'skip': skip, 'overlap': overlap}
        meta = {'version': 'last-frame-v2', 'job_id': 'video', 'width': '64', 'height': '96', 'fps': '24.0', 'count': '5', 'source_anchor_frame': str(skip), 'source_end_frame': '124', 'reference_source_frame': '123'}
        frames = np.full((5, 96, 64, 3), .1, np.float32); frames[-1, :, :, 1] = .2
        tensors = {'frames': frames}
        if overlap > 5 and extra:
            tensors['reference_frame'] = np.full((1, 96, 64, 3), .8, np.float32)
        header = {'__metadata__': meta}; offset = 0; data = b''
        for name, pixels in tensors.items():
            raw = pixels.tobytes(); header[name] = {'dtype': 'F32', 'shape': list(pixels.shape), 'data_offsets': [offset, offset + len(raw)]}; offset += len(raw); data += raw
        raw = json.dumps(header).encode(); path = Path(folder) / 'context.safetensors'; path.write_bytes(struct.pack('<Q', len(raw)) + raw + data)
        return path, expected

    def test_exact_last_raw_frame_and_extra_reference_for_larger_end_overlap(self):
        import numpy as np
        with tempfile.TemporaryDirectory() as temp:
            path, expected = self.anchor(temp)
            pixels = repaint.appearance_frame(path, expected)
            np.testing.assert_array_equal(pixels[0, 0], [25, 51, 25])
            path, expected = self.anchor(temp, overlap=107)
            np.testing.assert_array_equal(repaint.appearance_frame(path, expected)[0, 0], [204, 204, 204])
            path, expected = self.anchor(temp, overlap=107, extra=False)
            with self.assertRaisesRegex(ValueError, 'exact previous raw'):
                repaint.appearance_frame(path, expected)

    def test_wrong_job_range_or_truncated_tensor_never_substitutes_a_video_frame(self):
        with tempfile.TemporaryDirectory() as temp:
            path, expected = self.anchor(temp)
            for altered in [dict(expected, jobId='other'), dict(expected, skip=118), dict(expected, width=96)]:
                with self.assertRaisesRegex(ValueError, 'does not match'):
                    repaint.appearance_frame(path, altered)
            path.write_bytes(path.read_bytes()[:-4])
            with self.assertRaisesRegex(ValueError, 'incomplete or invalid'):
                repaint.appearance_frame(path, expected)

    def test_no_visible_face_is_explicit_and_multiple_faces_are_not_guessed(self):
        import numpy as np
        pixels = np.zeros((400, 240, 3), np.uint8)
        with patch.object(repaint, 'detect', return_value=[]):
            mask, warning = repaint.face_scope(pixels, None); self.assertIsNone(mask); self.assertIn('No clear face', warning)
        with patch.object(repaint, 'detect', return_value=[{'bbox': [80, 100, 60, 90], 'confidence': .99}]):
            mask, warning = repaint.face_scope(pixels, None); self.assertIsNone(warning); self.assertGreater(mask[145, 110], 240); self.assertFalse(mask[205:].any())
        with patch.object(repaint, 'detect', return_value=[{}, {}]):
            with self.assertRaisesRegex(ValueError, 'More than one face'):
                repaint.face_scope(pixels, None)

    def test_saved_target_receipt_is_reused_and_changed_inputs_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp, patch.object(repaint, 'face_scope', return_value=(None, 'Face hidden')):
            path, expected = self.anchor(temp); folder = Path(temp) / 'repaint'
            result = repaint.prepare(path, expected, folder, None)
            self.assertFalse(result['repaint']); self.assertEqual(repaint.prepare(path, expected, folder, None), result)
            (folder / 'target.png').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'saved segment repaint inputs changed'):
                repaint.prepare(path, expected, folder, None)


if __name__ == '__main__': unittest.main()
