"""Offline checks for selected downloads, strict health checks and stale tunnel protection."""
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from model_manifest import is_content_filter_weight, manifest_path, selected_manifest, required_setup_manifest
from managed_models import check_connection
from doctor import profile_schema_graph
from check_workflows import check_api
import managed_instance


class ModelProfileTests(unittest.TestCase):
    def setUp(self):
        self.full = selected_manifest()
        self.files = [item['destination'] for item in self.full['files']]
        self.i2v = next(name for name in self.files if 'lightx2v_I2V' in name)
        self.t2v = next(name for name in self.files if 'lightx2v_T2V' in name)

    def test_natural_plan_skips_only_inactive_speed_weights_and_preserves_pins(self):
        selected = selected_manifest([name for name in self.files if name != self.i2v])
        self.assertEqual(self.full['total_bytes'] - selected['total_bytes'], 738005744)
        for item in selected['files']:
            self.assertIn(item, self.full['files'])
        self.assertEqual(manifest_path('/workspace/character-swap', selected), manifest_path('/workspace/character-swap', selected))
        self.assertNotEqual(manifest_path('/workspace/character-swap', selected), manifest_path('/workspace/character-swap', self.full))

    def test_unknown_and_duplicate_downloads_are_rejected(self):
        for files in [['loras/user.safetensors'], self.files + ['../../untrusted'], self.files + [self.files[0]], 'all']:
            with self.subTest(files=files), self.assertRaises(ValueError):
                selected_manifest(files)

    def test_natural_and_quality_health_checks_do_not_require_unused_speed_files(self):
        original = json.loads((ROOT / 'workflows/api/scail2_int8_swap.json').read_text())
        catalog = json.loads((ROOT / 'integration-snapshot/object-info.json').read_text())
        catalog['LoraLoaderModelOnly']['input']['required']['lora_name'][0] = [
            Path(name).name for name in self.files if name.startswith('loras/') and name != self.i2v]
        natural = profile_schema_graph(original, selected_manifest([name for name in self.files if name != self.i2v]))
        self.assertEqual(natural['24']['inputs']['lora_name'], Path(self.t2v).name)
        self.assertEqual(check_api(natural, catalog), [])
        quality = profile_schema_graph(original, selected_manifest([name for name in self.files if name not in [self.i2v, self.t2v]]))
        self.assertNotIn('24', quality)
        self.assertEqual(quality['25']['inputs']['model'], ['23', 0])
        self.assertEqual(check_api(quality, catalog), [])
        self.assertEqual(original['24']['inputs']['lora_name'], Path(self.i2v).name)

    def test_single_file_requests_never_include_unselected_core_models(self):
        chosen = selected_manifest([self.t2v])
        self.assertEqual([item["destination"] for item in chosen["files"]], [self.t2v])

    def test_on_demand_download_rejects_stale_instance_ports_and_directories(self):
        config = {'instance_id': 123, 'local_port': 8188, 'remote_root': '/workspace/character-swap'}
        check_connection(config, 123)
        for altered in [{**config, 'instance_id': 456}, {**config, 'local_port': 9000}, {**config, 'remote_root': '/other'}]:
            with self.subTest(config=altered), self.assertRaises(ValueError):
                check_connection(altered, 123)

    def test_existing_setup_verifies_engine_without_requiring_model_weights(self):
        with patch.object(sys, 'argv', ['managed_instance.py', '--host', 'fixture.example', '--port', '23456', '--identity', '/tmp/fixture-key', '--instance-id', '123']), \
             patch.object(managed_instance, 'check_local', return_value={'ok': True}), \
             patch.object(managed_instance.vast, 'configure'), patch.object(managed_instance.vast, 'upload_package'), \
             patch.object(managed_instance.vast, 'tunnel') as tunnel, \
             patch.object(managed_instance.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'', stderr=b'')) as run:
            managed_instance.main()
            commands = [str(call.args[0]) for call in run.call_args_list]
            self.assertTrue(any('doctor.py' in command and '--runtime-only' in command for command in commands))
            self.assertFalse(any('required-models.json' in command for command in commands))
            self.assertFalse(any('download_models.py' in command for command in commands))
            self.assertTrue(tunnel.called)

    def test_facefusion_content_filter_is_not_a_download_or_readiness_requirement(self):
        names = [item['destination'] for item in self.full['files']]
        self.assertFalse(any(is_content_filter_weight(name) for name in names))
        with self.assertRaises(ValueError):
            selected_manifest(['face_consistency/facefusion/nsfw_1.onnx'])
        from facial_runtime import inspect
        from local_identity import status
        report = inspect(model_root=Path('/tmp/recast-missing-face-models'))
        self.assertFalse(any('nsfw_' in item for item in report['missing']))
        self.assertFalse(any(str(name).startswith('nsfw_') for name in status()['missing']))
        for relative in ('scripts/facial_worker.py', 'scripts/video_identity.py', 'scripts/local_identity.py'):
            self.assertNotIn('content_analyser', (ROOT / relative).read_text())

    def test_required_bundle_covers_natural_recipe_but_never_optional_extras(self):
        manifest = required_setup_manifest()
        names = {f['destination'] for f in manifest['files']}
        self.assertEqual(manifest['total_bytes'], 29738555883)
        self.assertEqual(len(names), 8)
        self.assertFalse(any('Instagoon' in name or 'lightx2v_I2V' in name for name in names))


if __name__ == '__main__':
    unittest.main()
