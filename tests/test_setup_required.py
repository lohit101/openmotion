"""Actual child-process tests for concurrent setup and failure cleanup."""
from pathlib import Path
import os
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from setup_required import run_parallel
import setup_required


class ParallelSetupTests(unittest.TestCase):
    def test_default_engine_setup_does_not_download_weights(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(setup_required, 'ROOT', Path(folder)), \
             patch.dict(os.environ, {'RECAST_SETUP_MODE': 'runtime'}), patch.object(setup_required, 'run_parallel') as parallel, \
             patch.object(setup_required.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            setup_required.main()
            tasks = parallel.call_args.args[0]
            self.assertEqual([label for label, command in tasks], ['ComfyUI runtime installation'])
            self.assertFalse(any('download_models.py' in str(command) for label, command in tasks))
            self.assertIn('--runtime-only', run.call_args.args[0])

    def test_legacy_full_bundle_requires_explicit_opt_in(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(setup_required, 'ROOT', Path(folder)), \
             patch.dict(os.environ, {'RECAST_SETUP_MODE': 'required'}), patch.object(setup_required, 'run_parallel') as parallel, \
             patch.object(setup_required.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            setup_required.main()
            self.assertEqual(len(parallel.call_args.args[0]), 2)
            self.assertIn('--manifest', run.call_args.args[0])

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
