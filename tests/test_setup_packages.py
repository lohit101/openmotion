"""Setup fast paths preserve pins, invalidation and original pip fallback offline."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import package_install as packages
import clarity_setup


class PackageSetupTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.root=Path(self.temporary.name)
        self.installer=packages.SetupInstaller(self.root)
        self.command=[str(self.root/'venv/bin/python'),'-m','pip','install','numpy==2.2.6']
        self.stack=ExitStack();self.stack.enter_context(patch.dict(os.environ,{},clear=True))
        self.stack.enter_context(patch.object(Path,'home',return_value=self.root))
        self.stack.enter_context(patch.object(packages.SetupInstaller,'uv',return_value=None))
        self.signature=self.stack.enter_context(patch.object(packages.SetupInstaller,'signature',return_value='environment-one'))
        self.run=self.stack.enter_context(patch.object(packages.subprocess,'run',return_value=subprocess.CompletedProcess(self.command,0)))

    def tearDown(self):self.stack.close();self.temporary.cleanup()

    def test_unchanged_environment_receipt_skips_repeated_package_checks(self):
        self.installer.run(self.command,check=True)
        packages.SetupInstaller(self.root).run(self.command,check=True)
        self.run.assert_called_once()

    def test_external_environment_change_invalidates_the_receipt(self):
        self.installer.run(self.command,check=True);self.signature.return_value='environment-two'
        packages.SetupInstaller(self.root).run(self.command,check=True)
        self.assertEqual(self.run.call_count,2)

    def test_nested_requirement_or_constraint_change_invalidates_the_receipt(self):
        requirements=self.root/'requirements.txt';constraints=self.root/'constraints.txt'
        requirements.write_text('-c constraints.txt\nnumpy==2.2.6\n');constraints.write_text('torch==2.7.1\n')
        command=self.command[:4]+['-r',str(requirements)]
        self.installer.run(command,check=True);self.installer.run(command,check=True)
        self.assertEqual(self.run.call_count,1)
        constraints.write_text('torch==2.7.1\nnumpy==2.2.6\n');self.installer.run(command,check=True)
        self.assertEqual(self.run.call_count,2)

    def test_local_editable_and_install_options_are_never_receipt_cached(self):
        for args in [['-e','/tmp/local'],['-r',str(self.root/'requirements.txt')]]:
            (self.root/'requirements.txt').write_text('-e ./sam2\n')
            command=self.command[:4]+args;self.installer.run(command,check=True);self.installer.run(command,check=True)
        self.assertEqual(self.run.call_count,4)

    def test_configured_force_reinstall_retains_original_pip_behavior(self):
        for _ in range(2):self.installer.run(self.command,check=True,env={'PIP_FORCE_REINSTALL':'1'})
        self.assertEqual(self.run.call_count,2)
        self.assertTrue(all(call.args[0]==self.command for call in self.run.call_args_list))

    def test_only_direct_exact_pins_use_uv_and_failure_falls_back_to_original_command(self):
        with patch.object(packages.SetupInstaller,'uv',return_value='/tools/uv'):
            self.run.side_effect=[subprocess.CompletedProcess([],1),subprocess.CompletedProcess([],0)]
            self.installer.run(self.command,check=True,env={'UV_NO_DEPS':'1','PIP_DEFAULT_TIMEOUT':'120'})
        first,second=self.run.call_args_list
        self.assertEqual(first.args[0][:6],['/tools/uv','pip','install','--no-config','--python',self.command[0]])
        self.assertIn('numpy==2.2.6',first.args[0]);self.assertIn('--no-cache',first.args[0])
        self.assertNotIn('UV_NO_DEPS',first.kwargs['env']);self.assertEqual(first.kwargs['env']['UV_HTTP_TIMEOUT'],'120')
        self.assertFalse(first.kwargs['check']);self.assertEqual(second.args[0],self.command);self.assertTrue(second.kwargs['check'])
        self.assertTrue(packages.pinned_arguments(['torch==2.7.1','--index-url','https://download.pytorch.org/whl/cu128']))
        for arguments in [['numpy'],['numpy>=2'],['-r','requirements.txt'],['--no-build-isolation','numpy==2'],['-e','.']]:
            self.assertFalse(packages.pinned_arguments(arguments))

    def test_original_pip_error_is_not_cached_as_success(self):
        self.run.side_effect=subprocess.CalledProcessError(1,self.command)
        with self.assertRaises(subprocess.CalledProcessError):self.installer.run(self.command,check=True)
        self.assertFalse(list(self.installer.folder.glob('*.json')))

    def test_later_dependency_changes_cannot_validate_an_earlier_install(self):
        state=['initial']
        self.signature.side_effect=lambda _:state[0]
        def install(command,**kwargs):state[0]=command[-1];return subprocess.CompletedProcess(command,0)
        self.run.side_effect=install
        self.installer.run(self.command,check=True)
        second=self.command[:4]+['numpy==1.26.4'];self.installer.run(second,check=True)
        self.installer.seal(self.command[0])
        packages.SetupInstaller(self.root).run(self.command,check=True)
        self.assertEqual(self.run.call_count,3)

    def test_concurrent_installers_share_an_environment_lock(self):
        def install(command,**kwargs):time.sleep(.03);return subprocess.CompletedProcess(command,0)
        self.run.side_effect=install
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(lambda _:packages.SetupInstaller(self.root).run(self.command,check=True),range(2)))
        self.run.assert_called_once()

    def test_seal_does_not_accept_a_changed_environment(self):
        self.installer.run(self.command,check=True);before=next(self.installer.folder.glob('*.json')).read_bytes()
        self.signature.return_value='external-change';self.installer.seal(self.command[0])
        self.assertEqual(next(self.installer.folder.glob('*.json')).read_bytes(),before)


class ClaritySetupTests(unittest.TestCase):
    def test_ready_or_running_preparation_does_not_launch_another_worker(self):
        for current in [{'ready':True,'preparing':False},{'ready':False,'preparing':True}]:
            with tempfile.TemporaryDirectory() as root,patch.object(clarity_setup.native,'ROOT',Path(root)),patch.object(clarity_setup.native,'inspect',return_value=current),patch.object(clarity_setup.subprocess,'Popen') as start,patch.object(sys,'argv',['clarity_setup.py','prepare']):
                clarity_setup.main();start.assert_not_called()

    def test_worker_keeps_original_preparation_and_does_not_mask_validation_failure(self):
        real=clarity_setup.native.subprocess
        try:
            with tempfile.TemporaryDirectory() as root,patch.object(clarity_setup.native,'ROOT',Path(root)),patch.object(clarity_setup.native,'prepare',side_effect=ValueError('kernel self-test failed')) as prepare,patch.object(sys,'argv',['clarity_setup.py','worker']):
                with self.assertRaisesRegex(ValueError,'kernel self-test failed'):clarity_setup.main()
                prepare.assert_called_once()
                self.assertEqual(json.loads((Path(root)/'state/setup.json').read_text()),{'error':'kernel self-test failed'})
        finally:clarity_setup.native.subprocess=real


if __name__=='__main__':unittest.main()
