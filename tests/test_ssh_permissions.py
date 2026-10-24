"""Check the startup repair locally without a rental or privileged filesystem changes."""
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from managed_instance import ssh_failure


class SSHPermissionTests(unittest.TestCase):
    def repair(self, root):
        return subprocess.run(['sh', str(ROOT / 'scripts/ssh_permissions.sh')], env={**os.environ,
            'RECAST_SSH_BASE': str(root), 'RECAST_SSH_OWNER': '%s:%s' % (os.getuid(), os.getgid()),
            'RECAST_SSH_ONCE': '1'}, capture_output=True, text=True)

    def test_repairs_directory_and_key_modes_without_replacing_key_content(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); ssh = root / '.ssh'; ssh.mkdir(); key = ssh / 'authorized_keys'
            value = b'ssh-ed25519 FixtureOnly not-a-real-key\n'; key.write_bytes(value)
            root.chmod(0o777); ssh.chmod(0o777); key.chmod(0o666)
            self.assertEqual(self.repair(root).returncode, 0)
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o755)
            self.assertEqual(stat.S_IMODE(ssh.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)
            self.assertEqual(key.read_bytes(), value)
            self.assertEqual(self.repair(root).returncode, 0)

    def test_handles_provider_creating_the_key_after_the_first_repair(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.assertEqual(self.repair(root).returncode, 0)
            key = root / '.ssh/authorized_keys'; self.assertFalse(key.exists())
            key.write_text('provider-key\n'); key.chmod(0o666)
            self.assertEqual(self.repair(root).returncode, 0)
            self.assertEqual(stat.S_IMODE(key.stat().st_mode), 0o600)

    def test_refuses_symlinked_keys_instead_of_changing_an_unrelated_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); (root / '.ssh').mkdir(); target = root / 'unrelated'
            target.write_text('unchanged'); target.chmod(0o644); (root / '.ssh/authorized_keys').symlink_to(target)
            self.assertNotEqual(self.repair(root).returncode, 0)
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o644)
            self.assertEqual(target.read_text(), 'unchanged')

    def test_distinguishes_key_rejection_from_host_identity_errors(self):
        self.assertIn('authorized_keys', ssh_failure('root@host: Permission denied (publickey).'))
        self.assertIn('not removed or bypassed', ssh_failure('REMOTE HOST IDENTIFICATION HAS CHANGED'))
        self.assertIn('host identity', ssh_failure('Host key verification failed'))
        self.assertIsNone(ssh_failure('Connection refused'))


if __name__ == '__main__':
    unittest.main()
