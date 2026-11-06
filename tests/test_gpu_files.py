"""GPU file cleanup uses real disposable files, never a rental or user media."""
from contextlib import contextmanager
import fcntl
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from gpu_files import assert_remote_idle, delete_file, list_files, parts, roots


class GpuFilesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        (self.root / 'models').mkdir()
        (self.root / 'outside').mkdir()
        self.models = self.root / 'models'

    def tearDown(self):
        self.temporary.cleanup()

    def entry(self, name):
        return next(item for item in list_files(self.models)['entries'] if item['name'] == name)

    def test_lists_all_extensions_and_pages_largest_files_without_recursing(self):
        (self.models / 'nested').mkdir()
        (self.models / 'nested/huge').write_bytes(b'x' * 300)
        for name, size in [('unknown.bin', 30), ('weights.gguf', 200), ('notes.txt', 1)]:
            (self.models / name).write_bytes(b'a' * size)
        first = list_files(self.models, limit=2)
        self.assertEqual([item['name'] for item in first['entries']], ['nested', 'weights.gguf'])
        second = list_files(self.models, offset=first['nextOffset'], limit=2)
        self.assertEqual([item['name'] for item in second['entries']], ['unknown.bin', 'notes.txt'])
        self.assertIsNone(second['nextOffset'])
        self.assertEqual(first['total'], 4)
        self.assertGreater(first['totalBytes'], 0)

    def test_deletes_only_the_selected_file_and_preserves_partial_and_other_files(self):
        file = self.models / 'weights.bin'
        file.write_bytes(b'weights')
        (self.models / 'weights.bin.part').write_bytes(b'partial')
        (self.models / 'keep.mp4').write_bytes(b'video')
        result = delete_file(self.models, file.name, self.entry(file.name)['token'])
        self.assertEqual(result['freedBytes'], 7)
        self.assertTrue(result['removed'])
        self.assertFalse(file.exists())
        self.assertEqual((self.models / 'weights.bin.part').read_bytes(), b'partial')
        self.assertEqual((self.models / 'keep.mp4').read_bytes(), b'video')

    def test_changed_or_replaced_file_requires_a_new_confirmation(self):
        file = self.models / 'custom.onnx'
        file.write_bytes(b'old')
        token = self.entry(file.name)['token']
        file.unlink()
        file.write_bytes(b'new data')
        with self.assertRaisesRegex(ValueError, 'changed'):
            delete_file(self.models, file.name, token)
        self.assertEqual(file.read_bytes(), b'new data')

    def test_missing_file_is_an_idempotent_noop(self):
        result = delete_file(self.models, 'gone.bin', '0' * 64)
        self.assertFalse(result['removed'])
        self.assertEqual(result['freedBytes'], 0)

    def test_invalid_paths_cannot_escape_the_root(self):
        for name in ['../outside/file', '/etc/passwd', 'a/../b', 'a//b', 'a\\b', 'a\x00b', '.', '']:
            with self.subTest(name=name), self.assertRaises(ValueError):
                delete_file(self.models, name, '0' * 64)
        self.assertEqual(parts('', empty=True), [])

    def test_symlink_roots_directories_and_targets_are_not_followed(self):
        external = self.root / 'outside/keep'
        external.write_bytes(b'keep')
        (self.models / 'linked').symlink_to(self.root / 'outside', target_is_directory=True)
        (self.models / 'alias.bin').symlink_to(external)
        self.assertFalse(self.entry('alias.bin')['deletable'])
        with self.assertRaises(OSError):
            list_files(self.models, 'linked')
        with self.assertRaises(ValueError):
            delete_file(self.models, 'alias.bin', self.entry('alias.bin')['token'])
        alias_root = self.root / 'alias-root'
        alias_root.symlink_to(self.models, target_is_directory=True)
        with self.assertRaises(OSError):
            list_files(alias_root)
        self.assertEqual(external.read_bytes(), b'keep')

    def test_hard_links_and_directories_cannot_be_deleted(self):
        file = self.models / 'shared'
        file.write_bytes(b'shared')
        os.link(file, self.root / 'outside/shared')
        self.assertFalse(self.entry('shared')['deletable'])
        with self.assertRaises(ValueError):
            delete_file(self.models, 'shared', self.entry('shared')['token'])
        (self.models / 'folder').mkdir()
        with self.assertRaises(ValueError):
            delete_file(self.models, 'folder', self.entry('folder')['token'])

    def test_held_download_lock_blocks_complete_and_partial_deletion(self):
        (self.models / 'weights.bin').write_bytes(b'a')
        (self.models / 'weights.bin.part').write_bytes(b'b')
        with (self.models / 'weights.bin.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for name in ['weights.bin', 'weights.bin.part']:
                with self.assertRaisesRegex(ValueError, 'transfer'):
                    delete_file(self.models, name, self.entry(name)['token'])
            with self.assertRaisesRegex(ValueError, 'locks'):
                delete_file(self.models, 'weights.bin.lock', self.entry('weights.bin.lock')['token'])

    def test_installation_root_comes_from_state_not_the_request(self):
        (self.root / 'state').mkdir()
        install = self.root / 'state/install.json'
        comfy = self.root / 'comfy'
        comfy.mkdir()
        install.write_text(json.dumps({'comfy_root': str(comfy)}))
        self.assertEqual(roots(self.root)['comfy'], comfy)
        self.assertEqual(roots(self.root)['output'], self.root / 'data/output')
        install.write_text(json.dumps({'comfy_root': '/'}))
        with self.assertRaises(ValueError):
            roots(self.root)

    def test_remote_activity_probe_refuses_busy_and_unknown_queues(self):
        @contextmanager
        def response(value):
            yield io.StringIO(json.dumps(value))
        for value in [{}, {'queue_running': [[1]], 'queue_pending': []}, {'queue_running': [], 'queue_pending': [[1]]}]:
            with patch('gpu_files.urllib.request.urlopen', return_value=response(value)), self.assertRaises(ValueError):
                assert_remote_idle(self.root)
        with patch('gpu_files.urllib.request.urlopen', return_value=response({'queue_running': [], 'queue_pending': []})), patch('gpu_files.Path.glob', return_value=[]):
            assert_remote_idle(self.root)


if __name__ == '__main__':
    unittest.main()
