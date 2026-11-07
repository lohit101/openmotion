"""OpenJutsu preparation observes existing work and never starts cloud compute."""
from contextlib import contextmanager
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import managed_openjutsu_tools as tools


@contextmanager
def response(value):
    yield io.StringIO(json.dumps(value))


class OpenJutsuToolsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.request = {'classes': ['H3'], 'inputs': {'H3': ['refs.ref_0']}, 'key': 'fixture'}
        self.registry = {'H3': {'input': {'optional': {'refs': ['COMFY_AUTOGROW_V3', {'template': {'prefix': 'ref_', 'max': 3, 'input': {'required': {'ref': ['IMAGE', {}]}}}}]}}}}

    def tearDown(self):
        self.temporary.cleanup()

    def test_readiness_checks_dynamic_input_support_not_just_node_names(self):
        self.assertEqual(tools.missing_tools(self.registry, self.request), [])
        for field in ['refs.ref_3', 'refs.ref_00', 'refs.ref_-1', 'refs.ref_0.extra', 'refs.other_0']:
            with self.subTest(field=field):
                self.assertEqual(tools.missing_tools(self.registry, {**self.request, 'inputs': {'H3': [field]}}), ['H3.' + field])
        self.assertEqual(tools.missing_tools({'H3': {}}, self.request), ['H3.refs.ref_0'])

    def test_ready_external_engine_is_read_only_even_on_explicit_prepare(self):
        with patch.object(tools.urllib.request, 'urlopen', return_value=response(self.registry)), patch.object(tools.subprocess, 'Popen') as start:
            value = tools.remote(self.root, self.request, True)
        self.assertTrue(value['ready']); start.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def managed_config(self, **changes):
        config = self.root / 'config/server.json'; config.parent.mkdir(exist_ok=True)
        config.write_text(json.dumps({'host': '127.0.0.1', 'port': 18189, **changes}))

    def test_managed_engine_uses_its_registered_port_for_readiness_and_queue_guards(self):
        self.managed_config()
        calls = []
        def fetch(url, **kwargs):
            calls.append(url)
            if url == 'http://127.0.0.1:18189/object_info': return response(self.registry)
            if url == 'http://127.0.0.1:18189/queue': return response({'queue_running': [], 'queue_pending': []})
            raise AssertionError('Wrong GPU endpoint: ' + url)
        with patch.object(tools.urllib.request, 'urlopen', side_effect=fetch), patch.object(tools.subprocess, 'Popen') as start:
            self.assertTrue(tools.remote(self.root, self.request, True)['ready'])
            tools.queue_idle(self.root)
        self.assertEqual(calls, ['http://127.0.0.1:18189/object_info', 'http://127.0.0.1:18189/queue'])
        start.assert_not_called()

    def test_changed_private_port_is_used_without_guessing_the_default(self):
        self.managed_config(port=19191)
        with patch.object(tools.urllib.request, 'urlopen', return_value=response(self.registry)) as fetch:
            self.assertTrue(tools.status(self.root, self.request)['ready'])
        fetch.assert_called_once_with('http://127.0.0.1:19191/object_info', timeout=8)

    def test_busy_managed_queue_blocks_installation_at_the_same_endpoint(self):
        self.managed_config()
        def fetch(url, **kwargs):
            self.assertTrue(url.startswith('http://127.0.0.1:18189/'))
            return response({} if url.endswith('/object_info') else {'queue_running': [[1]], 'queue_pending': []})
        with patch.object(tools.urllib.request, 'urlopen', side_effect=fetch), patch.object(tools.subprocess, 'Popen') as start:
            with self.assertRaisesRegex(ValueError, 'active or unknown'): tools.remote(self.root, self.request, True)
            start.assert_not_called()

    def test_configured_endpoint_is_not_replaced_with_a_different_engine_on_connection_failure(self):
        self.managed_config()
        with patch.object(tools.urllib.request, 'urlopen', side_effect=OSError('Unavailable')) as fetch:
            self.assertFalse(tools.status(self.root, self.request)['ready'])
        fetch.assert_called_once_with('http://127.0.0.1:18189/object_info', timeout=8)

    def test_invalid_or_public_managed_endpoints_are_rejected_before_network_access(self):
        for changes in [{'port': True}, {'port': 0}, {'port': 65536}, {'port': '18189'}, {'host': '0.0.0.0'}, {'host': 'example.com'}]:
            with self.subTest(changes=changes):
                self.managed_config(**changes)
                with patch.object(tools.urllib.request, 'urlopen') as fetch:
                    with self.assertRaisesRegex(ValueError, 'loopback'): tools.queue_idle(self.root)
                    fetch.assert_not_called()

    def test_worker_restarts_the_managed_engine_with_its_installed_python_environment(self):
        self.managed_config()
        (self.root / 'state/openjutsu-tools').mkdir(parents=True)
        (self.root / 'state/install.json').write_text(json.dumps({'comfy_root': str(self.root / 'comfy')}))
        request = {**self.request, 'comfyui': {'revision': 'fixture', 'repo': 'fixture'}, 'packs': []}
        with patch.dict(sys.modules, {'server': SimpleNamespace(running=lambda: {'pid': 123})}), patch.object(tools, 'queue_idle') as idle, patch.object(tools.subprocess, 'check_output', return_value='fixture\n'), patch.object(tools.subprocess, 'run') as run, patch.object(tools, 'restart_managed_engine') as restart, patch.object(tools, 'status', return_value={'missing': []}):
            tools.worker(self.root, request, 'fixture')
        run.assert_not_called()
        restart.assert_called_once_with(self.root, self.root / '.venv/bin/python')
        self.assertEqual(idle.call_count, 2)
        self.assertTrue(all(call.args == (self.root,) for call in idle.call_args_list))
        self.assertEqual(json.loads((self.root / 'state/openjutsu-tools/current.json').read_text())['state'], 'ready')

    def test_restart_waits_for_the_old_private_socket_to_close(self):
        self.managed_config()
        with patch.object(tools.subprocess, 'run') as run, patch.object(tools.socket, 'socket') as socket, patch.object(tools.time, 'sleep') as sleep:
            socket.return_value.__enter__.return_value.connect_ex.side_effect = [0, 0, 111]
            tools.restart_managed_engine(self.root, '/venv/python')
        self.assertEqual([call.args[0][-1] for call in run.call_args_list], ['stop', 'start'])
        self.assertEqual(sleep.call_count, 2)

    def test_restart_keeps_the_unrelated_port_guard_when_the_socket_stays_open(self):
        self.managed_config()
        with patch.object(tools.subprocess, 'run') as run, patch.object(tools.socket, 'socket') as socket, patch.object(tools.time, 'sleep'):
            socket.return_value.__enter__.return_value.connect_ex.return_value = 0
            with self.assertRaisesRegex(ValueError, 'No replacement'):
                tools.restart_managed_engine(self.root, '/venv/python')
        self.assertEqual([call.args[0][-1] for call in run.call_args_list], ['stop'])

    def test_face_requirements_reuse_existing_torch_without_sam2_cuda_build(self):
        with patch.object(tools.subprocess, 'run') as run:
            tools.install_requirements('/venv/python', '/nodes/Impact/requirements.txt', '/constraints.txt', True)
        call = run.call_args
        self.assertIn('--no-build-isolation', call.args[0])
        self.assertEqual(call.args[0][-4:], ['-r', '/nodes/Impact/requirements.txt', '-c', '/constraints.txt'])
        self.assertEqual(call.kwargs['env']['SAM2_BUILD_CUDA'], '0')
        self.assertTrue(call.kwargs['check'])

    def test_simple_requirements_keep_original_build_and_environment_policy(self):
        with patch.dict(tools.os.environ, {'SAM2_BUILD_CUDA': 'custom'}), patch.object(tools.subprocess, 'run') as run:
            tools.install_requirements('/venv/python', '/nodes/requirements.txt', '/constraints.txt', False)
        self.assertNotIn('--no-build-isolation', run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs['env']['SAM2_BUILD_CUDA'], 'custom')

    def test_unknown_or_busy_queue_cannot_start_tool_installation(self):
        for queue in [{}, {'queue_running': [[1]], 'queue_pending': []}, {'queue_running': [], 'queue_pending': [[1]]}]:
            with self.subTest(queue=queue), patch.object(tools.urllib.request, 'urlopen', side_effect=[response({}), response(queue)]), patch.object(tools.subprocess, 'Popen') as start:
                with self.assertRaisesRegex(ValueError, 'active or unknown'):
                    tools.remote(self.root, self.request, True)
                start.assert_not_called()

    def test_starting_worker_without_pid_remains_unknown_instead_of_ready(self):
        tools.atomic(self.root / 'state/openjutsu-tools/current.json', {'state': 'starting', 'pid': None, 'attempt': 'fixture'})
        with patch.object(tools.urllib.request, 'urlopen', return_value=response(self.registry)), patch.object(tools.subprocess, 'Popen') as start:
            value = tools.remote(self.root, self.request, True)
        self.assertTrue(value['unknown']); self.assertFalse(value['ready']); start.assert_not_called()

    def test_manifest_reuses_shared_files_without_duplicate_download_destinations(self):
        from model_manifest import selected_manifest
        root = Path(__file__).resolve().parents[1]
        config = json.loads((root / 'config/openjutsu-models.lock.json').read_text())
        selected = [f['destination'] for f in config['files']] + config['shared']
        files = selected_manifest(selected)['files']
        self.assertEqual(len(files), 7)
        self.assertEqual(len({f['destination'] for f in files}), 7)
        self.assertEqual(sum(f['size'] for f in files), 51162804168)


if __name__ == '__main__': unittest.main()
