"""A partial request upload must remain inspectable and cancellable."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import facial_worker
import facial_runtime


class FacialWorkerProtocolTests(unittest.TestCase):
    def call_empty_request(self, action):
        with tempfile.TemporaryDirectory() as directory:
            root, job = Path(directory), str(uuid.uuid4())
            folder = root / 'jobs' / job
            folder.mkdir(parents=True)
            output = io.StringIO()
            with patch.object(facial_worker, 'ROOT', root), patch.object(sys, 'argv', ['facial_worker.py', action, '--job', job]), contextlib.redirect_stdout(output):
                facial_worker.main()
            value = json.loads(output.getvalue().split('RECAST_FACIAL ', 1)[1])
            self.assertIs(value['running'], False)
            self.assertFalse((folder / 'request.json').exists())
            return value, (folder / 'result/CANCEL').is_file()

    def test_cancel_does_not_need_a_successfully_uploaded_request(self):
        _, cancelled = self.call_empty_request('cancel')
        self.assertTrue(cancelled)

    def test_poll_confirms_missing_handle_without_loading_models_or_request(self):
        value, _ = self.call_empty_request('poll')
        self.assertEqual(value['state'], 'interrupted')

    def test_cached_native_runtime_still_prepares_the_explicit_optional_observer(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(facial_runtime, 'ROOT', Path(directory)), \
                patch.object(facial_runtime, 'inspect', return_value={'runtimeReady': True}), \
                patch.object(facial_runtime, 'link_models'), patch.object(facial_runtime, 'write_ready_marker'), \
                patch.object(facial_runtime, 'prepare_eye_runtime') as optional:
            facial_runtime.prepare()
            optional.assert_not_called()
            facial_runtime.prepare('source-face-v5')
            optional.assert_called_once_with()

    def test_jaw_update_reuses_native_runtime_and_only_eye_variant_prepares_observer(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(facial_runtime, 'ROOT', Path(directory)), \
                patch.object(facial_runtime, 'inspect', return_value={'runtimeReady': True}), \
                patch.object(facial_runtime, 'link_models'), patch.object(facial_runtime, 'write_ready_marker'), \
                patch.object(facial_runtime, 'prepare_eye_runtime') as optional:
            facial_runtime.prepare('source-face-v6')
            facial_runtime.prepare('source-face-v7')
            facial_runtime.prepare('source-face-v9')
            facial_runtime.prepare('source-face-v10')
            optional.assert_not_called()
            facial_runtime.prepare('source-face-v8')
            optional.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
