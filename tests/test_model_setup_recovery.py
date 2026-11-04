"""Tracked setup protocol regression tests; no SSH, installs or models."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import managed_model_setup as managed
import model_setup_worker as worker


class ModelSetupRecoveryTests(unittest.TestCase):
    def request(self, version='source-face-v11'):
        return {'kind': 'facial', 'version': version, 'profile': 'a' * 64,
                'attempt': 'c48d43cd-f982-423e-af48-bca9bba08384'}

    def test_v11_status_is_accepted_without_starting_work(self):
        with tempfile.TemporaryDirectory() as root:
            request = self.request()
            stdout = io.StringIO()
            args = ['model_setup_worker.py', 'status', '--root', root, '--request', json.dumps(request)]
            with patch.object(sys, 'argv', args), patch.object(worker.subprocess, 'Popen') as spawn, contextlib.redirect_stdout(stdout):
                worker.main()
            line = stdout.getvalue().strip()
            self.assertTrue(line.startswith('RECAST_SETUP_STATE '))
            state = json.loads(line[len('RECAST_SETUP_STATE '):])
            self.assertEqual(state['requestSHA256'], worker.key_for(request))
            self.assertFalse(state['running'])
            self.assertTrue(state['confirmedStopped'])
            spawn.assert_not_called()

    def test_v12_is_rejected_before_status_or_spawn(self):
        with tempfile.TemporaryDirectory() as root:
            args = ['model_setup_worker.py', 'status', '--root', root, '--request', json.dumps(self.request('source-face-v12'))]
            with patch.object(sys, 'argv', args), patch.object(worker, 'status') as status, patch.object(worker.subprocess, 'Popen') as spawn:
                with self.assertRaisesRegex(ValueError, 'Unknown runtime preparation'):
                    worker.main()
            status.assert_not_called()
            spawn.assert_not_called()

    def test_remote_application_rejection_is_terminal_not_reconnected(self):
        error = subprocess.CalledProcessError(1, ['ssh'], output='',
            stderr='Traceback (most recent call last):\nValueError: Unknown runtime preparation.\n')
        cancelled = Mock(side_effect=[False, True])
        with patch.object(managed, 'upload', return_value=Path('/runtime/model_download_worker.py')), \
                patch.object(managed.vast, 'remote', side_effect=error) as remote, \
                patch.object(managed.time, 'sleep') as sleep, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError, 'Unknown runtime preparation'):
                managed.prepare({'remote_root': '/workspace/test'}, 'source-face-v11', 'a' * 64, cancelled)
        remote.assert_called_once()
        sleep.assert_not_called()

    def test_transport_255_only_observes_same_attempt_after_lost_start_reply(self):
        calls = []
        def remote(_config, args, **_kwargs):
            request = json.loads(args[args.index('--request') + 1])
            calls.append((args[2], request))
            if len(calls) == 1:
                raise subprocess.CalledProcessError(255, ['ssh'], stderr='Connection reset by peer')
            state = {'running': False, 'complete': True, 'error': None,
                     'requestSHA256': worker.key_for(request), 'confirmedStopped': True}
            return subprocess.CompletedProcess(args, 0, stdout='RECAST_SETUP_STATE ' + json.dumps(state) + '\n', stderr='')
        with patch.object(managed, 'upload', return_value=Path('/runtime/model_download_worker.py')), \
                patch.object(managed.vast, 'remote', side_effect=remote), \
                patch.object(managed.time, 'sleep'), contextlib.redirect_stdout(io.StringIO()):
            managed.prepare({'remote_root': '/workspace/test'}, 'source-face-v11', 'a' * 64)
        self.assertEqual([x[0] for x in calls], ['start', 'status'])
        self.assertEqual(calls[0][1], calls[1][1])

    def test_v11_worker_failure_persists_terminal_error_receipt(self):
        with tempfile.TemporaryDirectory() as root:
            request = self.request()
            key = worker.key_for(request)
            args = ['model_setup_worker.py', 'worker', '--root', root,
                    '--request', json.dumps(request), '--job', key]
            with patch.object(sys, 'argv', args), patch.object(worker.subprocess, 'run',
                    side_effect=subprocess.CalledProcessError(7, ['mock-runtime'])):
                with self.assertRaises(subprocess.CalledProcessError):
                    worker.main()
            receipt = json.loads((Path(root) / 'state/module-setups' / key / 'receipt.json').read_text())
            self.assertFalse(receipt['complete'])
            self.assertEqual(receipt['requestSHA256'], key)
            self.assertIn('Facial tool setup failed', receipt['error'])


if __name__ == '__main__':
    unittest.main()
