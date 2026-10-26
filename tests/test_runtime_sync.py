"""Changing a downloaded runtime must not leave old nodes live or kill a job."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sync_server', ROOT / 'scripts/server.py')
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


def response(value):
    return io.BytesIO(json.dumps(value).encode())


class RuntimeSyncTests(unittest.TestCase):
    def test_changed_code_waits_until_both_running_and_pending_queues_are_empty(self):
        events = []
        def read_queue(*_args, **_kwargs):
            events.append('queue')
            return response(queues.pop(0))
        queues = [dict(queue_running=[['paid-job']], queue_pending=[]), dict(queue_running=[], queue_pending=[['waiting-job']]), dict(queue_running=[], queue_pending=[])]
        with patch.object(server, 'configuration', return_value=({'comfy_root': '/fixture'}, {'port': 18189})), \
             patch.object(server, 'running', return_value={'runtime_key': 'old'}), \
             patch.object(server, 'runtime_key', return_value='new'), \
             patch.object(server.urllib.request, 'urlopen', side_effect=read_queue), \
             patch.object(server.time, 'sleep'), \
             patch.object(server, 'stop', side_effect=lambda: events.append('stop')), \
             patch.object(server, 'start', side_effect=lambda: events.append('start')):
            server.sync_runtime()
        self.assertEqual(events, ['queue', 'queue', 'queue', 'stop', 'start'])

    def test_matching_runtime_never_stops_a_warm_server(self):
        with patch.object(server, 'configuration', return_value=({'comfy_root': '/fixture'}, {'port': 18189})), \
             patch.object(server, 'running', return_value={'runtime_key': 'same'}), \
             patch.object(server, 'runtime_key', return_value='same'), \
             patch.object(server, 'stop') as stop, patch.object(server, 'start') as start, \
             patch.object(server.urllib.request, 'urlopen') as request:
            server.sync_runtime()
        stop.assert_not_called(); request.assert_not_called(); start.assert_called_once()

    def test_unreadable_queue_never_requests_a_restart(self):
        with patch.object(server, 'configuration', return_value=({'comfy_root': '/fixture'}, {'port': 18189})), \
             patch.object(server, 'running', return_value={'pid': 123}), \
             patch.object(server, 'runtime_key', return_value='new'), \
             patch.object(server.urllib.request, 'urlopen', return_value=response({'success': True})), \
             patch.object(server, 'stop') as stop, patch.object(server, 'start') as start:
            with self.assertRaisesRegex(RuntimeError, 'No server restart'):
                server.sync_runtime()
        stop.assert_not_called(); start.assert_not_called()

    def test_key_tracks_code_and_settings_but_ignores_downloaded_model_weights(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); comfy = root / 'comfy'; helpers = comfy / 'custom_nodes/character_swap_helpers'
            helpers.mkdir(parents=True); (helpers / '__init__.py').write_text('initial')
            (root / 'config').mkdir(); (root / 'config/server.json').write_text('{}')
            (root / 'state').mkdir(); (root / 'state/model-paths.yaml').write_text('paths')
            install = {'comfy_root': str(comfy)}
            with patch.object(server, 'ROOT', root), patch.object(server, 'STATE', root / 'state'), \
                 patch.object(server.subprocess, 'run', return_value=Mock(returncode=0, stdout='pinned')):
                first = server.runtime_key(install)
                (root / 'models').mkdir(); (root / 'models/large.safetensors').write_bytes(b'model')
                self.assertEqual(first, server.runtime_key(install))
                (helpers / '__init__.py').write_text('updated')
                self.assertNotEqual(first, server.runtime_key(install))

    def test_source_verification_rejects_old_helper_code_and_unloaded_pid_signature(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); comfy = root / 'comfy'; source = root / 'custom_nodes/character_swap_helpers'; target = comfy / 'custom_nodes/character_swap_helpers'
            source.mkdir(parents=True); target.mkdir(parents=True); (root / 'config').mkdir()
            (source / '__init__.py').write_text('new'); (target / '__init__.py').write_text('old')
            (root / 'config/runtime.lock.json').write_text(json.dumps(dict(comfyui_commit='pin', video_helper_commit='pin', viggle_commit='pin')))
            with patch.object(server, 'ROOT', root), patch.object(server.subprocess, 'run', return_value=Mock(returncode=0, stdout='pin')), \
                 patch.object(server, 'runtime_key', return_value='new-key'), patch.object(server, 'running', return_value={'pid': 123}):
                with self.assertRaisesRegex(RuntimeError, 'helper code'):
                    server.verify_runtime_source({'comfy_root': str(comfy)})
                (target / '__init__.py').write_text('new')
                with self.assertRaisesRegex(RuntimeError, 'has not loaded'):
                    server.verify_runtime_source({'comfy_root': str(comfy)})
                with patch.object(server, 'running', return_value={'pid': 123, 'runtime_key': 'new-key'}):
                    server.verify_runtime_source({'comfy_root': str(comfy)})


if __name__ == '__main__':
    unittest.main()
