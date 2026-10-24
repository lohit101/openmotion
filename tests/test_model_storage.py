"""Model removal stays confined to optional LoRAs and cooperates with downloads."""
import fcntl
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from model_storage import inventory, remove_lora
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

    def test_protects_required_adapters_and_rejects_traversal(self):
        required = next(f['destination'][6:] for f in required_setup_manifest()['files'] if f['destination'].startswith('loras/'))
        file = self.root / 'loras' / required
        file.write_bytes(b'required')
        for name in [required, '../outside.safetensors', '/outside.safetensors', 'styles//file.safetensors', 'styles/../file.safetensors', 'styles/file.pt', 'styles\\file.safetensors']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                remove_lora(self.root, name)
        self.assertEqual(file.read_bytes(), b'required')

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


if __name__ == '__main__':
    unittest.main()
