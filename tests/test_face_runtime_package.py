"""The files copied to a GPU must include every local module they import."""
import ast
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from managed_facial_consistency import FACIAL_RUNTIME_FILES
from managed_video_identity import FACE_REFINEMENT_RUNTIME_FILES

# model_manifest.write_remote_manifest imports vast only on this Mac. The GPU
# package must carry model_manifest itself and must not carry the SSH controller.
CONTROLLER_ONLY = {'scripts/vast.py'}


def local_scripts(path):
    found = set()
    for node in ast.walk(ast.parse(path.read_text())):
        modules = []
        if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            modules.append(node.module.split('.')[0])
        elif isinstance(node, ast.Import):
            modules.extend(alias.name.split('.')[0] for alias in node.names)
        for module in modules:
            name = f'scripts/{module}.py'
            if name not in CONTROLLER_ONLY and (ROOT / name).is_file():
                found.add(name)
    return found


def missing_modules(files):
    package = set(files)
    pending = {name for name in package if name.endswith('.py')}
    seen, absent = set(), set()
    while pending:
        name = pending.pop()
        if name in seen:
            continue
        seen.add(name)
        if name not in package:
            absent.add(name)
            continue
        pending.update(local_scripts(ROOT / name) - seen)
    return absent


class FaceRuntimePackageTests(unittest.TestCase):
    def test_uploaded_packages_contain_their_local_imports(self):
        for files in (FACIAL_RUNTIME_FILES, FACE_REFINEMENT_RUNTIME_FILES):
            with self.subTest(files=files[0]):
                self.assertIn('scripts/model_manifest.py', files)
                self.assertNotIn('scripts/vast.py', files)
                self.assertTrue(all((ROOT / name).is_file() for name in files))
                self.assertEqual(missing_modules(files), set())

    def test_isolated_face_package_imports_without_the_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in FACIAL_RUNTIME_FILES:
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / name).read_bytes())
            result = subprocess.run([sys.executable, '-c', 'import facial_runtime, facial_worker'], cwd=root / 'scripts', capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            for name in FACE_REFINEMENT_RUNTIME_FILES:
                if not name.endswith('.py'):
                    continue
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((ROOT / name).read_bytes())
            result = subprocess.run([sys.executable, '-c', 'import local_identity, video_identity, gpu_identity_worker'], cwd=root / 'scripts', capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
