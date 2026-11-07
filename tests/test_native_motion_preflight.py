"""Native motion rental needs SSH/deployment tools, not legacy face framing."""
from contextlib import redirect_stdout
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import managed_instance as managed


class NativeMotionPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.identity = self.root / 'key'; self.identity.write_text('fixture key, never used for SSH')
        Path(str(self.identity) + '.pub').write_text('ssh-ed25519 FixtureOnly fixture\n')

    def tearDown(self): self.temporary.cleanup()

    def run_command(self, command, **kwargs):
        if command[0] == 'ssh-keygen': return SimpleNamespace(returncode=0, stdout='ssh-ed25519 FixtureOnly\n')
        if 'setup_local_geometry.py' in str(command): raise subprocess.CalledProcessError(1, command, stderr=b'Local reference framing is not ready')
        raise AssertionError('Unexpected operation: ' + str(command))

    def test_native_motion_checks_ssh_and_package_without_calling_missing_geometry(self):
        with patch.object(managed.shutil, 'which', side_effect=lambda tool: '/fixture/' + tool), patch.object(managed.subprocess, 'run', side_effect=self.run_command) as run, patch.object(managed.socket, 'socket') as socket:
            socket.return_value.__enter__.return_value.connect_ex.return_value = 1
            self.assertTrue(managed.check_local(self.identity, native_motion=True)['ok'])
            self.assertEqual(len(run.call_args_list), 1)
            self.assertEqual(run.call_args.args[0][0], 'ssh-keygen')

    def test_legacy_profile_still_requires_geometry(self):
        with patch.object(managed.shutil, 'which', side_effect=lambda tool: '/fixture/' + tool), patch.object(managed.subprocess, 'run', side_effect=self.run_command):
            with self.assertRaises(subprocess.CalledProcessError): managed.check_local(self.identity)

    def test_native_motion_does_not_skip_key_authentication(self):
        with patch.object(managed.shutil, 'which', return_value='/fixture/tool'), patch.object(managed.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout='')):
            with self.assertRaisesRegex(ValueError, 'cannot authenticate'): managed.check_local(self.identity, native_motion=True)

    def test_native_flag_reaches_check_only_and_actual_setup_entry_points(self):
        for check_only in [True, False]:
            args = ['managed_instance.py', '--identity', str(self.identity), '--native-motion'] + (['--check-local'] if check_only else ['--host', 'fixture.example', '--port', '23456', '--instance-id', '123'])
            with self.subTest(check_only=check_only), patch.object(sys, 'argv', args), patch.object(managed, 'check_local', return_value={'ok': True}) as check, patch.object(managed.vast, 'configure'), patch.object(managed.vast, 'upload_package'), patch.object(managed.vast, 'tunnel'), patch.object(managed.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'', stderr=b'')), redirect_stdout(io.StringIO()):
                managed.main(); check.assert_called_once_with(self.identity, native_motion=True)

    def test_native_launcher_preserves_data_and_uses_normal_server_without_geometry_setup(self):
        bin_dir = self.root / 'bin'; bin_dir.mkdir(); log = self.root / 'commands'
        programs = {'node': '#!/bin/sh\nprintf "node %s %s %s\\n" "$*" "$PORT" "$RECAST_DATA" >> "$PREFLIGHT_LOG"\n', 'npm': '#!/bin/sh\nexit 0\n', 'python3': '#!/bin/sh\nexit 99\n', 'ffmpeg': '#!/bin/sh\nexit 0\n', 'ffprobe': '#!/bin/sh\nexit 0\n'}
        for name, body in programs.items():
            file = bin_dir / name; file.write_text(body); file.chmod(0o755)
        env = {**os.environ, 'PATH': str(bin_dir) + ':/usr/bin:/bin', 'PREFLIGHT_LOG': str(log), 'PORT': '3103', 'RECAST_DATA': str(self.root / 'retained-data')}
        value = subprocess.run(['/bin/bash', str(ROOT / 'scripts/openjutsu-studio.sh')], env=env, capture_output=True, text=True)
        self.assertEqual(value.returncode, 0, value.stderr)
        self.assertIn('node dist-server/index.js 3103 ' + str(self.root / 'retained-data'), log.read_text())


if __name__ == '__main__': unittest.main()
