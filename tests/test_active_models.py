"""Active provisioning policy; no network, paid compute or real weight transfers."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from model_policy import active_model_ids, assert_downloadable
from model_manifest import selected_manifest
from active_model_manifest import download_manifest
import model_download_worker as worker
import download_models
import download_active_models

class ActiveModelsTests(unittest.TestCase):
    def test_catalog_is_exact_and_shared_files_remain_available(self):
        active = active_model_ids()
        manifest = download_manifest()
        self.assertEqual(len(active), 22)
        self.assertEqual(active, {item['destination'] for item in manifest['files']})
        self.assertEqual(len(manifest['files']), 22)
        for name in ('text_encoders/qwen3vl_8b_int8_convrot.safetensors', 'insightface/models/buffalo_l/w600k_r50.onnx'):
            self.assertIn(name, active)
        self.assertEqual(manifest['total_bytes'], sum(item['size'] for item in manifest['files']))

    def test_no_retired_or_mixed_plan_can_provision(self):
        retired = {item['destination'] for item in selected_manifest()['files']} - active_model_ids()
        self.assertGreater(len(retired), 20)
        for name in retired:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Retired'):
                download_manifest([name])
        with self.assertRaisesRegex(ValueError, 'Retired'):
            assert_downloadable([next(iter(active_model_ids())), next(iter(retired))])

    def test_detached_worker_rejects_obsolete_files_but_can_observe_them(self):
        item = next(item for item in selected_manifest()['files'] if item['destination'] not in active_model_ids())
        manifest = {'files': [item], 'total_bytes': item['size']}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve(); folder = root / 'state/model-downloads' / worker.key_for(manifest)
            worker.atomic(folder / 'manifest.json', manifest)
            with patch.object(worker.subprocess, 'Popen') as spawn, patch.object(download_models, 'download') as download:
                for action in (lambda: worker.launch(root, folder, True), lambda: worker.run(root, folder)):
                    with self.assertRaisesRegex(ValueError, 'Retired'): action()
                spawn.assert_not_called(); download.assert_not_called()
            with patch.object(worker, 'owns_process', return_value=False):
                self.assertTrue(worker.status(root, folder)['confirmedStopped'])
                self.assertTrue(worker.cancel(root, folder)['confirmedStopped'])

    def test_standalone_cli_refuses_old_manifests_before_downloading(self):
        item = next(item for item in selected_manifest()['files'] if item['destination'] not in active_model_ids())
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / 'old.json'; manifest.write_text(json.dumps({'files': [item], 'total_bytes': item['size']}))
            argv = ['download_models.py', '--manifest', str(manifest), '--model-dir', str(Path(tmp) / 'models')]
            with patch.object(sys, 'argv', argv), patch.object(download_models, 'download') as download:
                with self.assertRaisesRegex(ValueError, 'Retired'): download_active_models.main()
                download.assert_not_called()

if __name__ == '__main__': unittest.main()
