"""Actual child-process tests for concurrent setup and failure cleanup."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from setup_required import run_parallel


class ParallelSetupTests(unittest.TestCase):
    def test_both_jobs_start_before_either_completes(self):
        with tempfile.TemporaryDirectory() as folder:
            code = "import sys,time;from pathlib import Path;p=Path(sys.argv[1]);p.touch();other=Path(sys.argv[2]);end=time.monotonic()+3\nwhile not other.exists() and time.monotonic()<end:time.sleep(.02)\nsys.exit(0 if other.exists() else 9)"
            a, b = str(Path(folder) / 'runtime'), str(Path(folder) / 'models')
            run_parallel([('runtime', [sys.executable, '-c', code, a, b]), ('models', [sys.executable, '-c', code, b, a])])

    def test_an_actual_error_stops_sibling_work_but_keeps_partial_data(self):
        with tempfile.TemporaryDirectory() as folder:
            part = str(Path(folder) / 'model.part')
            download = "import sys,time;from pathlib import Path;Path(sys.argv[1]).write_bytes(b'partial');time.sleep(30)"
            fail = "import sys,time;from pathlib import Path;end=time.monotonic()+3\nwhile not Path(sys.argv[1]).exists() and time.monotonic()<end:time.sleep(.02)\nsys.exit(7)"
            with self.assertRaisesRegex(RuntimeError, 'runtime failed with exit code 7'):
                run_parallel([('runtime', [sys.executable, '-c', fail, part]), ('models', [sys.executable, '-c', download, part])])
            self.assertEqual(Path(part).read_bytes(), b'partial')


if __name__ == '__main__':
    unittest.main()
