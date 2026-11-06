"""OpenJutsu preparation observes existing work and never starts cloud compute."""
from contextlib import contextmanager
import io
import json
from pathlib import Path
import sys
import tempfile
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
