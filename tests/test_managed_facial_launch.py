"""A rejected facial launch must expose its cause without inventing a stop."""
import contextlib
import io
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import managed_facial_consistency as managed


class ManagedFacialLaunchTests(unittest.TestCase):
    def test_rejected_launch_checks_only_the_same_worker(self):
        config, job = {'remote_root': '/workspace/test'}, 'saved-job'
        error = subprocess.CalledProcessError(1, ['ssh'])
        output = io.StringIO()
        with patch.object(managed, 'call', side_effect=[error, {'running': False}]) as remote, \
                contextlib.redirect_stdout(output), self.assertRaises(subprocess.CalledProcessError):
            managed.launch(config, job)
        self.assertEqual(remote.call_args_list, [call(config, 'launch', job), call(config, 'poll', job)])
        self.assertEqual(output.getvalue().strip(), 'RECAST_FACIAL_STOPPED')

    def test_unknown_or_running_worker_never_confirms_a_stop(self):
        for state in [{'running': True}, {}, ValueError('unreadable status'), OSError('offline')]:
            with self.subTest(state=state):
                output = io.StringIO()
                error = subprocess.CalledProcessError(1, ['ssh'])
                with patch.object(managed, 'call', side_effect=[error, state]), \
                        contextlib.redirect_stdout(output), self.assertRaises(subprocess.CalledProcessError):
                    managed.launch({}, 'saved-job')
                self.assertNotIn('RECAST_FACIAL_STOPPED', output.getvalue())

    def test_successful_launch_does_not_send_a_second_action(self):
        with patch.object(managed, 'call', return_value={}) as remote:
            managed.launch({}, 'saved-job')
        remote.assert_called_once_with({}, 'launch', 'saved-job')

    def test_actual_remote_failure_is_visible(self):
        output = io.StringIO()
        error = subprocess.CalledProcessError(1, ['ssh'], stderr='Insufficient working space: saved frames retained.')
        with patch.object(managed.vast, 'remote', side_effect=error), contextlib.redirect_stderr(output), \
                self.assertRaises(subprocess.CalledProcessError):
            managed.call({'remote_root': '/workspace/test'}, 'launch', 'saved-job')
        self.assertIn('Insufficient working space: saved frames retained.', output.getvalue())

    def test_memory_admission_failure_only_confirms_an_exact_stopped_worker(self):
        for running in [False, True]:
            with self.subTest(running=running):
                output = io.StringIO()
                error = subprocess.CalledProcessError(1, ['ssh'], stderr='Not enough free GPU memory; saved video kept.')
                with patch.object(managed.vast, 'remote', side_effect=error), \
                        patch.object(managed, 'call', return_value={'running': running}) as poll, \
                        contextlib.redirect_stdout(output), self.assertRaisesRegex(ValueError, 'saved video kept'):
                    managed.prepare_memory({'remote_root': '/workspace/test'}, 'saved-job', 'run')
                poll.assert_called_once_with({'remote_root': '/workspace/test'}, 'poll', 'saved-job')
                self.assertEqual('RECAST_FACIAL_STOPPED' in output.getvalue(), not running)


if __name__ == '__main__':
    unittest.main()
