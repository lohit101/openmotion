"""Transient SSH outages do not abort idempotent setup or weaken authentication."""
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from managed_instance import retry_ssh


class SetupSSHRetryTests(unittest.TestCase):
    def test_retries_transient_transport_loss_on_the_same_operation(self):
        for detail in [b'Connection refused', b'Connection reset by peer', b'Connection closed by remote host', b'Broken pipe']:
            with self.subTest(detail=detail), patch('managed_instance.time.sleep') as sleep:
                operation = Mock(side_effect=[subprocess.CalledProcessError(255, ['ssh'], stderr=detail), 'connected'])
                self.assertEqual(retry_ssh(operation, 'starting setup'), 'connected')
                self.assertEqual(operation.call_count, 2)
                sleep.assert_called_once_with(3)

    def test_does_not_retry_authentication_or_changed_host_identity(self):
        for detail in [b'Permission denied (publickey)', b'Host key verification failed', b'REMOTE HOST IDENTIFICATION HAS CHANGED']:
            with self.subTest(detail=detail), patch('managed_instance.time.sleep') as sleep:
                operation = Mock(side_effect=subprocess.CalledProcessError(255, ['ssh'], stderr=detail))
                with self.assertRaises(SystemExit):
                    retry_ssh(operation, 'starting setup')
                operation.assert_called_once()
                sleep.assert_not_called()

    def test_real_program_failures_and_local_forward_errors_remain_errors(self):
        for code, detail in [(1, b'Runtime installation failed'), (255, b'bind: Address already in use')]:
            with self.subTest(code=code), patch('managed_instance.time.sleep') as sleep:
                operation = Mock(side_effect=subprocess.CalledProcessError(code, ['ssh'], stderr=detail))
                with self.assertRaises(subprocess.CalledProcessError):
                    retry_ssh(operation, 'starting setup')
                operation.assert_called_once()
                sleep.assert_not_called()


if __name__ == '__main__':
    unittest.main()
