"""Managed transport status must never confuse unreachable with idle/missing."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import managed_upscale as managed
import upscale_worker as worker


class ClarityProtocolTests(unittest.TestCase):
    def invoke(self, action, result):
        config = {'remote_root': '/workspace/character-swap'}
        with patch.object(sys, 'argv', ['managed_upscale.py', '--instance-id', '123', '--action', action]), \
             patch.object(managed.vast, 'load', return_value=config), \
             patch.object(managed, 'check_connection'), \
             patch.object(managed.vast, 'ssh_arguments', return_value=['ssh']), \
             patch.object(managed.vast, 'destination', return_value='test.invalid'), \
             patch.object(managed.subprocess, 'run', return_value=result):
            return managed.main()

    def test_unreachable_status_never_claims_missing_or_stopped(self):
        with patch.object(managed, 'call') as remote, patch.object(managed, 'upload') as upload:
            with self.assertRaisesRegex(ValueError, 'unconfirmed'):
                self.invoke('status', subprocess.CompletedProcess([], 255))
            remote.assert_not_called()
            upload.assert_not_called()

    def test_missing_runtime_status_is_read_only(self):
        with patch.object(managed, 'call') as remote, patch.object(managed, 'upload') as upload, contextlib.redirect_stdout(io.StringIO()) as output:
            self.invoke('status', subprocess.CompletedProcess([], 1))
            value = json.loads(output.getvalue().split('RECAST_UPSCALE ', 1)[1])
            self.assertFalse(value['ready'])
            remote.assert_not_called()
            upload.assert_not_called()

    def test_preparation_does_not_replace_an_active_runtime(self):
        with patch.object(managed, 'call', return_value={'processing': True}) as remote, patch.object(managed, 'upload') as upload:
            with self.assertRaisesRegex(ValueError, 'existing Clarity work'):
                self.invoke('prepare', subprocess.CompletedProcess([], 0))
            upload.assert_not_called()
            self.assertEqual(remote.call_args.args[1], 'status')

    def test_setup_children_keep_idle_protection_after_parent_loss(self):
        with patch.object(worker, 'state', return_value={'pid': 501}), patch.object(worker.os, 'killpg'), \
             patch.object(worker.subprocess, 'check_output', return_value='501 Sl\n502 S\n'):
            self.assertTrue(worker.setup_running())
        with patch.object(worker, 'state', return_value={'pid': 501}), patch.object(worker.os, 'killpg'), \
             patch.object(worker.subprocess, 'check_output', return_value='501 Z\n'):
            self.assertFalse(worker.setup_running())
        with patch.object(worker, 'state', return_value={'pid': 501}), patch.object(worker.os, 'killpg'), \
             patch.object(worker.subprocess, 'check_output', side_effect=OSError('unknown')):
            self.assertTrue(worker.setup_running())

    def test_cancelled_remote_job_never_relaunches(self):
        job = '00000000-0000-4000-8000-000000000001'
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            folder = root / 'jobs' / job
            folder.mkdir(parents=True)
            (folder / 'CANCEL').touch()
            with patch.object(worker, 'ROOT', root), patch.object(worker, 'running', return_value=False), \
                 patch.object(sys, 'argv', ['upscale_worker.py', 'launch', '--job', job]), \
                 patch.object(worker.subprocess, 'Popen') as process:
                with self.assertRaisesRegex(ValueError, 'explicit retry'):
                    worker.main()
                process.assert_not_called()


if __name__ == '__main__':
    unittest.main()
