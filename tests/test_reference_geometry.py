"""Offline framing regressions: geometry, ambiguity, safe writes and CPU warps."""

import importlib.util
import json
import math
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import reference_geometry as geometry


def face(box, confidence=0.95):
    return {"bbox": box, "confidence": confidence}


class StubDetector:
    def __init__(self, results):
        self.results = iter(results)

    def detect(self, _image):
        return next(self.results)


class GeometryRulesTests(unittest.TestCase):
    def test_uniform_transform_matches_face_area_and_center(self):
        source, reference = face([200, 100, 160, 240]), face([20, 30, 80, 120])
        transform = geometry.affine_for_faces(source, reference)
        self.assertEqual(transform, {"scale": 2, "translateX": 160, "translateY": 40})
        self.assertEqual(2 * (20 + 40) + 160, 200 + 80)
        self.assertEqual(2 * (30 + 60) + 40, 100 + 120)

    def test_invalid_or_implausible_geometry_fails(self):
        good = face([0, 0, 100, 120])
        for invalid in [face([0, 0, 0, 5]), face([math.nan, 0, 50, 60]), face([0, 0, 10, 20], math.inf)]:
            with self.subTest(invalid=invalid), self.assertRaises(geometry.GeometryError):
                geometry.affine_for_faces(good, invalid)
        for tiny_or_huge in [face([0, 0, 1, 1]), face([0, 0, 10000, 10000])]:
            with self.assertRaises(geometry.GeometryError):
                geometry.affine_for_faces(good, tiny_or_huge)

    def test_earliest_clear_anchor_skips_missing_faces_but_rejects_ambiguity(self):
        detector = StubDetector([[], [face([10, 20, 30, 40])], []])
        index, image, result = geometry.first_anchor([(0, "a"), (1, "b"), (2, "c")], detector)
        self.assertEqual((index, image, result["bbox"]), (1, "b", [10, 20, 30, 40]))
        with self.assertRaisesRegex(geometry.GeometryError, "More than one"):
            geometry.first_anchor([(0, "a")], StubDetector([[face([0, 0, 10, 20]), face([40, 0, 10, 20])]]))
        with self.assertRaisesRegex(geometry.GeometryError, "first eight"):
            geometry.first_anchor([(0, "a")], StubDetector([[]]))

    def test_reference_is_single_confident_face_and_bad_landmarks_fail(self):
        good = face([20, 30, 80, 120])
        self.assertEqual(geometry.single_face([good, face([1, 2, 3, 4], 0.4)], "reference")["bbox"], good["bbox"])
        for values in [[], [face([1, 2, 3, 4], 0.6)], [good, good]]:
            with self.assertRaises(geometry.GeometryError):
                geometry.single_face(values, "reference")
        with self.assertRaises(geometry.GeometryError):
            geometry.validate_face({**good, "landmarks": [[0, math.nan]] * 5})
        with self.assertRaises(geometry.GeometryError):
            geometry.validate_face({**good, "landmarks": "invalid"})

    def test_outside_canvas_or_heavily_cropped_face_is_not_an_anchor(self):
        for box in [[1000, 1000, 80, 120], [-200, 10, 240, 100], [0, -200, 100, 240]]:
            with self.assertRaises(geometry.GeometryError):
                geometry.validate_face_on_canvas(face(box), 704, 1248)
        self.assertEqual(geometry.validate_face_on_canvas(face([-10, 10, 100, 120]), 704, 1248)["bbox"][0], -10)

    def test_scale_and_position_are_normalized_across_output_sizes(self):
        source = face([100, 200, 100, 160])
        doubled = face([200, 400, 200, 320])
        exact = geometry.compare_faces(source, doubled, (480, 864), (960, 1728))
        self.assertEqual(exact["headScale"], 1)
        self.assertEqual(exact["centerOffsetDiagonal"], 0)
        self.assertTrue(exact["scaleMatched"] and exact["positionMatched"])
        drift = geometry.compare_faces(source, face([40, 200, 60, 96]), (480, 864), (480, 864))
        self.assertAlmostEqual(drift["headScale"], 0.6)
        self.assertFalse(drift["scaleMatched"])
        self.assertFalse(drift["positionMatched"])

    def test_paths_cannot_overwrite_inputs_or_each_other(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            source.write_bytes(b"original")
            for outputs in [[source], [Path(directory) / "new.png"] * 2]:
                with self.assertRaises(geometry.GeometryError):
                    geometry.protect_paths([source], outputs)
            self.assertEqual(source.read_bytes(), b"original")

    def test_time_sampling_uses_shared_duration_at_distinct_fps(self):
        first = {"frames": 49, "fps": 24}
        second = {"frames": 33, "fps": 16}
        self.assertEqual(geometry.sample_times(first, second), [0, 0.5, 1, 1.5, 2])
        with self.assertRaises(geometry.GeometryError):
            geometry.sample_times({"frames": 1, "fps": 24}, second)


HAS_OPENCV = importlib.util.find_spec("cv2") is not None


@unittest.skipUnless(HAS_OPENCV, "Run in the local geometry environment for OpenCV integration checks")
class CPUWarpTests(unittest.TestCase):
    def checked_fixture(self, output_faces):
        import cv2
        import numpy as np

        class Capture:
            def __init__(self):
                self.reads = 0
                self.released = False

            def isOpened(self):
                return True

            def get(self, key):
                return {cv2.CAP_PROP_FPS: 2, cv2.CAP_PROP_FRAME_COUNT: 3,
                        cv2.CAP_PROP_FRAME_WIDTH: 192, cv2.CAP_PROP_FRAME_HEIGHT: 256}[key]

            def set(self, _key, _value):
                return True

            def read(self):
                self.reads += 1
                return True, np.zeros((256, 192, 3), dtype=np.uint8)

            def release(self):
                self.released = True

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / "source.mp4", root / "output.mp4"
            source.write_bytes(b"source original"); output.write_bytes(b"output original")
            source_cap, output_cap = Capture(), Capture()
            detections = []
            for found in output_faces:
                detections.extend([[face([40, 50, 80, 120])], found])
            with patch.object(cv2, "VideoCapture", side_effect=[source_cap, output_cap]):
                result = geometry.check(source, output, root / "check.json", root / "model.onnx", StubDetector(detections))
            self.assertEqual(source.read_bytes(), b"source original")
            self.assertEqual(output.read_bytes(), b"output original")
            self.assertEqual((source_cap.reads, output_cap.reads), (3, 3))
            self.assertTrue(source_cap.released and output_cap.released)
            self.assertNotIn(str(root), json.dumps(result))
            return result

    def test_affine_translation_keeps_shape_and_black_outside(self):
        import numpy as np
        original = np.full((5, 7, 3), 255, dtype=np.uint8)
        result = geometry.warp_reference(original, 12, 10, {"scale": 1, "translateX": 3, "translateY": 2})
        self.assertEqual(result.shape, (10, 12, 3))
        np.testing.assert_array_equal(result[2:7, 3:10], original)
        self.assertEqual(int(result[:2].max()), 0)
        self.assertEqual(int(result[:, :3].max()), 0)
        np.testing.assert_array_equal(original, np.full((5, 7, 3), 255, dtype=np.uint8))

    def test_prepare_writes_normalized_png_and_sanitized_report(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, reference = directory / "source.mp4", directory / "reference.png"
            output, report = directory / "aligned.png", directory / "framing.json"
            source.write_bytes(b"fixture source")
            image = np.full((120, 80, 3), 80, dtype=np.uint8)
            cv2.imwrite(str(reference), image)
            detector = StubDetector([[face([20, 20, 40, 60])], [face([40, 30, 80, 120])]])
            with patch.object(geometry, "initial_frames", return_value=iter([(0, np.zeros((256, 192, 3), dtype=np.uint8))])):
                result = geometry.prepare(source, reference, output, report, directory / "model.onnx", detector)
            self.assertEqual(result["status"], "aligned")
            self.assertEqual((result["width"], result["height"], result["anchorFrame"]), (192, 256, 0))
            self.assertEqual(cv2.imread(str(output)).shape, (256, 192, 3))
            self.assertEqual(result["preparedSha256"], geometry.sha256(output))
            self.assertNotIn(str(directory), json.dumps(result))
            self.assertEqual(json.loads(report.read_text()), result)
            self.assertEqual(source.read_bytes(), b"fixture source")

    def test_failed_preparation_does_not_replace_existing_outputs(self):
        import cv2
        import numpy as np
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            source, reference = directory / "source.mp4", directory / "reference.png"
            output, report = directory / "aligned.png", directory / "framing.json"
            source.write_bytes(b"source")
            cv2.imwrite(str(reference), np.zeros((100, 100, 3), dtype=np.uint8))
            output.write_bytes(b"previous image")
            report.write_text("previous report")
            with self.assertRaises(geometry.GeometryError):
                geometry.prepare(source, reference, output, report, directory / "model.onnx", StubDetector([[]]))
            self.assertEqual(output.read_bytes(), b"previous image")
            self.assertEqual(report.read_text(), "previous report")

    def test_audit_reports_drift_without_retrying_or_changing_media(self):
        result = self.checked_fixture([[face([10, 50, 48, 72])]] * 3)
        self.assertEqual(result["status"], "warning")
        self.assertEqual(len(result["warnings"]), 6)
        self.assertTrue(all(abs(item["headScale"] - 0.6) < 0.000001 for item in result["samples"]))

    def test_audit_never_calls_an_ambiguous_or_missing_face_matched(self):
        good = [face([40, 50, 80, 120])]
        result = self.checked_fixture([[], good + good, good])
        self.assertEqual(result["status"], "unverified")
        self.assertEqual([item["status"] for item in result["samples"]], ["unverified", "unverified", "matched"])
        self.assertEqual(len(result["warnings"]), 2)

    def test_audit_matching_control_has_no_warning(self):
        result = self.checked_fixture([[face([40, 50, 80, 120])]] * 3)
        self.assertEqual(result["status"], "matched")
        self.assertEqual(result["warnings"], [])


if __name__ == "__main__":
    unittest.main()
