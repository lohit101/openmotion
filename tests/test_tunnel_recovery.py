"""A dead local forwarding master must not imply a GPU or model restart."""
from pathlib import Path
import os
import shlex
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import vast


class TunnelRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.config = {'host': 'ssh.fixture.test', 'port': 12345, 'user': 'root', 'identity': '',
                       'local_port': 8188, 'remote_port': 18189, 'instance_id': 123, 'host_key_alias': 'recast-instance-123'}

    def command(self, **changes):
        cfg = {**self.config, **changes}
        return shlex.join(['ssh', '-M', '-S', vast.control_path(cfg), '-f', '-N', '-L',
                           '127.0.0.1:%d:127.0.0.1:%d' % (cfg['local_port'], cfg['remote_port']), vast.destination(cfg)])

    def test_control_check_has_a_deadline_and_a_hung_socket_is_not_healthy(self):
        with patch.object(vast.subprocess, 'run', side_effect=subprocess.TimeoutExpired('ssh', 3)) as run:
            self.assertFalse(vast.master_running(self.config))
            self.assertEqual(run.call_args.kwargs['timeout'], 3)

    def test_only_matches_the_same_profile_background_forwarder(self):
        rows = ['321 ' + self.command(), '322 ' + self.command(port=54321), '323 ' + self.command(local_port=9999),
                '324 ' + self.command(host='other.fixture.test'), '325 node unrelated.js',
                '326 ' + self.command().replace(' -M ', ' ')]
        with patch.object(vast.subprocess, 'run', return_value=Mock(stdout='\n'.join(rows))) as run:
            self.assertEqual(vast.owned_forwarders(self.config), {321})
            self.assertEqual(run.call_args.args[0], ['ps', '-axo', 'pid=,command='])

    def test_replaces_only_the_owned_local_master_and_removes_its_stale_socket(self):
        with tempfile.TemporaryDirectory() as temporary:
            control = Path(temporary) / 'fixture.sock'
            sock = socket.socket(socket.AF_UNIX); sock.bind(str(control)); sock.close()
            with patch.object(vast, 'control_path', return_value=str(control)), \
                    patch.object(vast, 'owned_forwarders', side_effect=[{321}, set()]), \
                    patch.object(vast, 'master_running', return_value=False), \
                    patch.object(vast.os, 'kill') as kill, patch.object(vast, 'remote') as remote:
                vast.recreate_tunnel(self.config)
                kill.assert_called_once_with(321, signal.SIGTERM)
                self.assertFalse(control.exists()); remote.assert_not_called()

    def test_does_not_escalate_against_a_pid_that_no_longer_matches(self):
        with patch.object(vast, 'owned_forwarders', side_effect=[{321}, set()]), \
                patch.object(vast, 'master_running', return_value=False), \
                patch.object(vast, 'control_path', return_value='/no-such-recast-fixture/control.sock'), \
                patch.object(vast.os, 'kill') as kill:
            vast.recreate_tunnel(self.config)
            kill.assert_called_once_with(321, signal.SIGTERM)

    def test_refuses_an_unverified_active_control_master(self):
        with patch.object(vast, 'owned_forwarders', return_value=set()), \
                patch.object(vast, 'master_running', return_value=True), patch.object(vast.os, 'kill') as kill:
            with self.assertRaisesRegex(SystemExit, 'still active'):
                vast.recreate_tunnel(self.config)
            kill.assert_not_called()

    def test_preserves_regular_files_and_symlinks_at_the_control_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / 'keep'; target.write_text('keep')
            link = Path(temporary) / 'link'; link.symlink_to(target)
            for control in [target, link]:
                with self.subTest(control=control), patch.object(vast, 'control_path', return_value=str(control)), \
                        patch.object(vast, 'owned_forwarders', return_value=set()), patch.object(vast, 'master_running', return_value=False):
                    with self.assertRaisesRegex(SystemExit, 'not an owned SSH socket'):
                        vast.recreate_tunnel(self.config)
                    self.assertEqual(target.read_text(), 'keep'); self.assertTrue(link.is_symlink())

    def test_recreate_cli_rejects_a_changed_rental_before_touching_any_connection(self):
        with patch.object(vast, 'load', return_value={**self.config, 'remote_root': '/fixture'}), \
                patch.object(sys, 'argv', ['vast.py', 'tunnel', '--instance-id', '456', '--recreate']), \
                patch.object(vast, 'recreate_tunnel') as recreate, patch.object(vast, 'tunnel') as tunnel:
            with self.assertRaisesRegex(SystemExit, 'different instance'):
                vast.main()
            recreate.assert_not_called(); tunnel.assert_not_called()

    @unittest.skipUnless(Path('/usr/bin/ssh').exists(), 'OpenSSH is required for the local process fixture')
    def test_recreates_a_real_local_ssh_process_without_touching_an_unrelated_process(self):
        # No authentication or external connection: the local socket never sends
        # an SSH banner. This verifies real ps ownership matching and termination.
        with tempfile.TemporaryDirectory() as temporary, socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); listener.listen(1)
            cfg = {**self.config, 'host': '127.0.0.1', 'port': listener.getsockname()[1]}
            control = str(Path(temporary) / 'fixture.sock')
            args = ['/usr/bin/ssh', '-F', '/dev/null', '-p', str(cfg['port']), '-o', 'BatchMode=yes',
                    '-o', 'IdentityAgent=none', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=10',
                    '-M', '-S', control, '-f', '-N', '-L', '127.0.0.1:8188:127.0.0.1:18189', vast.destination(cfg)]
            child = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            other = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(10)'])
            try:
                with patch.object(vast, 'control_path', return_value=control):
                    until = time.monotonic() + 2
                    while child.pid not in vast.owned_forwarders(cfg) and time.monotonic() < until:
                        time.sleep(.02)
                    self.assertIn(child.pid, vast.owned_forwarders(cfg))
                    vast.recreate_tunnel(cfg)
                self.assertEqual(child.wait(timeout=2), -signal.SIGTERM)
                self.assertIsNone(other.poll())
            finally:
                for process in [child, other]:
                    if process.poll() is None:
                        process.kill()
                    process.wait(timeout=2)


if __name__ == '__main__':
    unittest.main()
