"""Source-archive extraction only; no installs, network, models or GPU."""
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import facial_occlusion_runtime as runtime


class OcclusionSourceArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.archive = self.root / 'source.tar.gz'
        self.staged = self.root / 'staged'
        self.staged.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def archive_with(self, entries):
        base = [('repo/sam2/build_sam.py', tarfile.REGTYPE, b'build = 1\n'),
                ('repo/sam2/sam2_video_predictor.py', tarfile.REGTYPE, b'predictor = 1\n')]
        with tarfile.open(self.archive, 'w:gz') as output:
            for name, kind, value in [*base, *entries]:
                member = tarfile.TarInfo(name)
                member.type = kind
                if kind == tarfile.REGTYPE:
                    member.size = len(value)
                    output.addfile(member, io.BytesIO(value))
                else:
                    member.linkname = value
                    output.addfile(member)
        return self.archive

    def test_all_four_official_alias_shapes_materialize_as_regular_bytes(self):
        entries = []
        for name in ['b+', 'l', 's', 't']:
            base = f'sam2_hiera_{name}.yaml'
            entries.extend([(f'repo/sam2/configs/sam2/{base}', tarfile.REGTYPE, (name + '\n').encode()),
                            (f'repo/sam2/{base}', tarfile.SYMTYPE, f'configs/sam2/{base}')])
        manifest = runtime.extract_source_archive(self.archive_with(entries), self.staged)
        self.assertEqual(len(manifest), 10)
        for name in ['b+', 'l', 's', 't']:
            file = self.staged / f'sam2/sam2_hiera_{name}.yaml'
            self.assertFalse(file.is_symlink())
            self.assertEqual(file.read_bytes(), (name + '\n').encode())
            self.assertEqual(manifest[str(file.relative_to(self.staged))]['sha256'], runtime.digest(file))

    def test_hardlink_and_parent_relative_alias_chain_are_in_archive_only(self):
        entries = [('repo/sam2/configs/model.yaml', tarfile.REGTYPE, b'config\n'),
                   ('repo/sam2/aliases/model.yaml', tarfile.SYMTYPE, '../configs/model.yaml'),
                   ('repo/sam2/model.yaml', tarfile.LNKTYPE, 'repo/sam2/aliases/model.yaml')]
        manifest = runtime.extract_source_archive(self.archive_with(entries), self.staged)
        self.assertEqual((self.staged / 'sam2/model.yaml').read_bytes(), b'config\n')
        self.assertFalse((self.staged / 'sam2/model.yaml').is_symlink())
        self.assertEqual(manifest['sam2/model.yaml'], manifest['sam2/configs/model.yaml'])

    def test_absolute_escaping_missing_and_cyclic_aliases_name_the_offender(self):
        cases = [
            [('repo/sam2/bad.py', tarfile.SYMTYPE, '/etc/passwd')],
            [('repo/sam2/bad.py', tarfile.SYMTYPE, '../../outside.py')],
            [('repo/sam2/bad.py', tarfile.LNKTYPE, 'elsewhere/sam2/good.py')],
            [('repo/sam2/bad.py', tarfile.SYMTYPE, 'missing.py')],
            [('repo/sam2/bad.py', tarfile.SYMTYPE, 'other.py'),
             ('repo/sam2/other.py', tarfile.SYMTYPE, 'bad.py')],
        ]
        for i, entries in enumerate(cases):
            staged = self.root / f'case-{i}'
            staged.mkdir()
            with self.subTest(case=i), self.assertRaisesRegex(ValueError, 'bad.py|missing.py'):
                runtime.extract_source_archive(self.archive_with(entries), staged)

    def test_special_oversized_duplicate_and_traversal_entries_are_rejected(self):
        cases = [
            [('repo/sam2/bad.py', tarfile.FIFOTYPE, '')],
            [('repo/sam2/bad.py', tarfile.REGTYPE, b'x' * (8 * 1024 ** 2 + 1))],
            [('repo/sam2/bad.py', tarfile.REGTYPE, b'a'), ('repo/sam2/bad.py', tarfile.REGTYPE, b'b')],
            [('repo/../bad.py', tarfile.REGTYPE, b'escape')],
        ]
        for i, entries in enumerate(cases):
            staged = self.root / f'invalid-{i}'
            staged.mkdir()
            with self.subTest(case=i), self.assertRaisesRegex(ValueError, 'bad.py'):
                runtime.extract_source_archive(self.archive_with(entries), staged)

    def test_existing_filesystem_link_is_never_followed(self):
        outside = self.root / 'outside'
        outside.mkdir()
        linked = self.root / 'linked'
        linked.symlink_to(outside, target_is_directory=True)
        archive = self.archive_with([])
        with self.assertRaisesRegex(ValueError, 'new empty'):
            runtime.extract_source_archive(archive, linked)
        self.assertEqual(list(outside.iterdir()), [])

    def test_full_prepare_source_marker_verifies_materialized_alias_and_reuses(self):
        archive = self.archive_with([
            ('repo/sam2/configs/model.yaml', tarfile.REGTYPE, b'config\n'),
            ('repo/sam2/model.yaml', tarfile.SYMTYPE, 'configs/model.yaml')])
        cfg = {'sam_revision': 'pinned', 'sam_archive_sha256': runtime.digest(archive),
               'sam_archive_url': 'https://invalid.example/source.tar.gz'}
        with patch.object(runtime, 'ROOT', self.root), patch.object(runtime, 'settings', return_value=cfg), \
                patch.object(runtime.urllib.request, 'urlopen', side_effect=lambda *_a, **_k: archive.open('rb')) as network:
            runtime.prepare_source()
            self.assertTrue(runtime.source_ready(verify=True))
            runtime.prepare_source()
            network.assert_called_once()
            marker = json.loads((runtime.source_root() / '.recast-source.json').read_text())
            self.assertEqual(len(marker['files']), 4)
            alias = runtime.source_root() / 'sam2/model.yaml'
            self.assertFalse(alias.is_symlink())
            alias.write_bytes(b'changed')
            self.assertFalse(runtime.source_ready(verify=True))
            with self.assertRaisesRegex(ValueError, 'Existing files were preserved'):
                runtime.prepare_source()


if __name__ == '__main__':
    unittest.main()
