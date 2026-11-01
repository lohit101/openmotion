"""Explicit weight removal stays confined to allowed files and download locks."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from model_storage import inventory, remove_lora, remove_model
from model_manifest import required_setup_manifest


class ModelStorageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / 'models'
        (self.root / 'loras/styles').mkdir(parents=True)

    def tearDown(self):
        self.temporary.cleanup()

    def test_removes_weights_partial_and_stamp_but_preserves_other_models(self):
        name = 'styles/social.safetensors'
        file = self.root / 'loras' / name
        file.write_bytes(b'weights')
        file.with_name(file.name + '.part').write_bytes(b'partial')
        file.with_name(file.name + '.verified.json').write_bytes(b'{}')
        other = self.root / 'loras/keep.safetensors'
        other.write_bytes(b'keep')
        before = inventory(self.root)['loras']
        self.assertEqual(next(f for f in before if f['name'] == name)['partialSize'], 7)
        self.assertEqual(remove_lora(self.root, name), {'name': name, 'freedBytes': 16, 'removed': True})
        self.assertFalse(file.exists())
        self.assertEqual(other.read_bytes(), b'keep')
        self.assertEqual(remove_lora(self.root, name)['freedBytes'], 0)

    def test_all_adapters_are_optional_but_traversal_is_still_rejected(self):
        required = next(f['destination'][6:] for f in required_setup_manifest()['files'] if f['destination'].startswith('loras/'))
        file = self.root / 'loras' / required
        file.write_bytes(b'required')
        for name in ['../outside.safetensors', '/outside.safetensors', 'styles//file.safetensors', 'styles/../file.safetensors', 'styles/file.pt', 'styles\\file.safetensors']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                remove_lora(self.root, name)
        self.assertEqual(file.read_bytes(), b'required')
        self.assertEqual(remove_lora(self.root, required)['freedBytes'], 8)

    def test_refuses_file_directory_and_metadata_symlinks_without_touching_targets(self):
        outside = Path(self.temporary.name) / 'outside.safetensors'
        outside.write_bytes(b'outside')
        link = self.root / 'loras/linked.safetensors'
        link.symlink_to(outside)
        with self.assertRaises(ValueError):
            remove_lora(self.root, link.name)
        directory = self.root / 'loras/external'
        directory.symlink_to(outside.parent, target_is_directory=True)
        with self.assertRaises(OSError):
            remove_lora(self.root, 'external/outside.safetensors')
        file = self.root / 'loras/social.safetensors'
        file.write_bytes(b'keep until all targets are checked')
        file.with_name(file.name + '.verified.json').symlink_to(outside)
        with self.assertRaises(ValueError):
            remove_lora(self.root, file.name)
        self.assertTrue(file.exists())
        self.assertEqual(outside.read_bytes(), b'outside')
        self.assertNotIn(link.name, [f['name'] for f in inventory(self.root)['loras']])

    def test_respects_an_active_download_lock(self):
        file = self.root / 'loras/social.safetensors'
        file.write_bytes(b'keep')
        with file.with_name(file.name + '.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with self.assertRaisesRegex(ValueError, 'downloading'):
                remove_lora(self.root, file.name)
        self.assertTrue(file.exists())

    def test_catalog_core_encoder_vae_and_upscale_files_are_deletable(self):
        for name in ['diffusion_models/editor.safetensors', 'text_encoders/encoder.bin', 'vae/image.safetensors', 'upscale/turbo/decoder.ckpt', 'face_consistency/detector.onnx']:
            with self.subTest(name=name):
                file = self.root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'weights')
                file.with_name(file.name + '.part').write_bytes(b'partial')
                file.with_name(file.name + '.verified.json').write_bytes(b'{}')
                self.assertEqual(remove_model(self.root, name, [name])['freedBytes'], 16)
                self.assertFalse(file.exists())
                self.assertEqual(remove_model(self.root, name, [name])['freedBytes'], 0)

    def test_missing_directory_and_partial_only_delete_are_idempotent(self):
        name = 'diffusion_models/editor.safetensors'
        self.assertFalse(remove_model(self.root, name, [name])['removed'])
        file = self.root / name
        file.parent.mkdir()
        file.with_name(file.name + '.part').write_bytes(b'partial')
        self.assertEqual(remove_model(self.root, name, [name])['freedBytes'], 7)

    def test_core_deletion_rejects_unknown_paths_links_and_active_transfers(self):
        name = 'vae/keep.safetensors'
        file = self.root / name
        file.parent.mkdir()
        file.write_bytes(b'keep')
        for invalid in ['../keep.safetensors', '/vae/keep.safetensors', 'vae//keep.safetensors', 'vae/../keep.safetensors', 'config.json']:
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                remove_model(self.root, invalid, [name])
        with self.assertRaises(ValueError):
            remove_model(self.root, name, [])
        with file.with_name(file.name + '.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            with self.assertRaisesRegex(ValueError, 'downloading'):
                remove_model(self.root, name, [name])
        linked = file.with_name('linked.safetensors'); linked.symlink_to(file)
        with self.assertRaises(ValueError):
            remove_model(self.root, 'vae/linked.safetensors', ['vae/linked.safetensors'])
        self.assertEqual(file.read_bytes(), b'keep')

    def test_current_helper_runs_on_retained_hosts_and_reports_measured_free_space(self):
        helper = (Path(__file__).resolve().parents[1] / 'scripts/model_storage.py').read_text()
        name = 'upscale/turbo/decoder.ckpt'
        file = self.root / name; file.parent.mkdir(parents=True); file.write_bytes(b'fixture')
        command = [sys.executable, '-c', helper, '--model-dir', str(self.root)]
        result = subprocess.run(command + ['--delete-file', name, '--allowed-files', json.dumps([name])], capture_output=True, text=True, check=True)
        receipt = json.loads(result.stdout.removeprefix('RECAST_MODEL_STORAGE '))
        self.assertEqual(receipt['name'], name); self.assertEqual(receipt['freedBytes'], 7)
        self.assertGreater(receipt['freeBytes'], 0); self.assertFalse(file.exists())
        face = Path(self.temporary.name) / 'face-runtime'
        relative = '.assets/models/hyperswap.onnx'
        model = face / relative; model.parent.mkdir(parents=True); model.write_bytes(b'face')
        result = subprocess.run(command + ['--delete-file', 'face-refinement/hyperswap.onnx', '--face-dir', str(face), '--face-files', json.dumps({'face-refinement/hyperswap.onnx': relative})], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout.removeprefix('RECAST_MODEL_STORAGE '))['freedBytes'], 4)
        self.assertFalse(model.exists())


if __name__ == '__main__':
    unittest.main()
