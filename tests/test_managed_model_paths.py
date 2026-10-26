"""Model-patch upgrades must work without restarting a cached engine."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from managed_models import MODEL_PATCH_PATHS


class ManagedModelPathTests(unittest.TestCase):
    def fixture(self, temp):
        root, comfy = Path(temp) / 'swap', Path(temp) / 'comfy'
        (root / 'state').mkdir(parents=True)
        (root / 'models/model_patches').mkdir(parents=True)
        (root / 'state/install.json').write_text(json.dumps({'comfy_root': str(comfy)}))
        (root / 'models/model_patches/control.safetensors').write_bytes(b'verified fixture')
        return root, comfy

    def run_script(self, root, names):
        return subprocess.run([sys.executable, '-c', MODEL_PATCH_PATHS, str(root), json.dumps(names)], capture_output=True)

    def test_registration_is_idempotent_and_uses_existing_verified_bytes(self):
        with tempfile.TemporaryDirectory() as temp:
            root, comfy = self.fixture(temp)
            for _ in range(2):
                result = self.run_script(root, ['model_patches/control.safetensors'])
                self.assertEqual(result.returncode, 0, result.stderr)
            alias = comfy / 'models/model_patches/control.safetensors'
            self.assertTrue(alias.is_symlink())
            self.assertEqual(alias.read_bytes(), b'verified fixture')

    def test_existing_models_and_unsafe_destinations_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            root, comfy = self.fixture(temp)
            folder = comfy / 'models/model_patches'; folder.mkdir(parents=True)
            alias = folder / 'control.safetensors'; alias.write_bytes(b'other model')
            self.assertNotEqual(self.run_script(root, ['model_patches/control.safetensors']).returncode, 0)
            self.assertEqual(alias.read_bytes(), b'other model')
            self.assertNotEqual(self.run_script(root, ['model_patches/../../escape.safetensors']).returncode, 0)


if __name__ == '__main__':
    unittest.main()
