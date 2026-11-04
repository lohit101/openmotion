"""Mocked helper deployment only: never SSH, start an engine, or load models."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import managed_viggle_tools as tools


class ManagedViggleToolsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        self.snapshot=self.root/'snapshot';self.snapshot.mkdir()
        self.comfy=self.root/'existing-comfy';(self.root/'config').mkdir();(self.root/'state').mkdir();(self.root/'scripts').mkdir()
        (self.root/'config/server.json').write_text(json.dumps({'port':8188}))
        (self.root/'state/install.json').write_text(json.dumps({'comfy_root':str(self.comfy)}))
        (self.root/'scripts/server.py').write_text("def running():return {'runtime_key':'current'}\ndef runtime_key(_):return 'current'\n")
        (self.snapshot/'shared_anchor.py').write_text('# existing owned helper bytes\n')
        self.manifest={'key':'fingerprint','files':{'shared_anchor.py':tools.sha(self.snapshot/'shared_anchor.py')}}
    def tearDown(self):self.temp.cleanup()
    def test_status_payload_is_valid_readonly_python_without_recursing_into_main(self):
        code=tools.status_program('/workspace/character-swap')
        compile(code,'status-payload','exec')
        self.assertIn("__file__ = '/workspace/character-swap/scripts/managed_viggle_tools.py'",code)
        self.assertNotIn("if __name__ == '__main__': main()",code)
    def test_busy_queue_blocks_all_helper_mutation_and_server_actions(self):
        with patch.object(tools,'get_json',return_value={'queue_running':[['foreign']], 'queue_pending':[]}),patch.object(tools.subprocess,'run')as run:
            with self.assertRaisesRegex(ValueError,'active or unknown'):tools.install_helpers(self.root,self.snapshot,self.manifest)
        run.assert_not_called();self.assertFalse((self.comfy/'custom_nodes/character_swap_helpers/shared_anchor.py').exists())
    def test_explicit_idle_update_copies_only_bound_helpers_and_calls_existing_sync(self):
        with patch.object(tools,'get_json',return_value={'queue_running':[],'queue_pending':[]}),patch.object(tools.subprocess,'run')as run:
            tools.install_helpers(self.root,self.snapshot,self.manifest)
        command=run.call_args.args[0]
        self.assertEqual(command,[sys.executable,str(self.root/'scripts/server.py'),'sync'])
        self.assertEqual(run.call_args.kwargs['timeout'],120)
        for directory in [self.root/'custom_nodes/character_swap_helpers',self.comfy/'custom_nodes/character_swap_helpers']:
            self.assertEqual(tools.sha(directory/'shared_anchor.py'),self.manifest['files']['shared_anchor.py'])
        self.assertFalse(any(any(word in arg for word in ['bootstrap','pip','download','vast'])for arg in command))
    def test_changed_or_symlinked_snapshot_does_not_overwrite_installed_code(self):
        (self.snapshot/'shared_anchor.py').write_text('changed')
        with patch.object(tools,'get_json',return_value={'queue_running':[],'queue_pending':[]}),patch.object(tools.subprocess,'run')as run:
            with self.assertRaisesRegex(ValueError,'changed'):tools.install_helpers(self.root,self.snapshot,self.manifest)
        run.assert_not_called()
    def test_running_or_unknown_owned_worker_stays_busy_without_readiness_probe(self):
        for ownership in [(True,False),(False,True)]:
            with self.subTest(ownership=ownership),patch.object(tools,'owned_process',return_value=ownership),patch.object(tools,'get_json')as fetch:
                status=tools.remote_status(self.root,self.manifest)
                self.assertFalse(status['confirmedStopped']);self.assertFalse(status['ready']);fetch.assert_not_called()
    def test_terminal_current_files_and_loaded_runtime_are_required_for_ready(self):
        target=self.comfy/'custom_nodes/character_swap_helpers';target.mkdir(parents=True)
        (target/'shared_anchor.py').write_bytes((self.snapshot/'shared_anchor.py').read_bytes())
        with patch.object(tools,'owned_process',return_value=(False,False)),patch.object(tools,'get_json',side_effect=lambda url:{url.rsplit('/',1)[-1]:{}}):
            status=tools.remote_status(self.root,self.manifest)
        self.assertTrue(status['ready']);self.assertTrue(status['confirmedStopped'])
        (target/'shared_anchor.py').write_text('different')
        with patch.object(tools,'owned_process',return_value=(False,False)),patch.object(tools,'get_json',side_effect=lambda url:{url.rsplit('/',1)[-1]:{}}):
            self.assertFalse(tools.remote_status(self.root,self.manifest)['ready'])
    def test_recovery_observes_one_existing_worker_and_never_starts_another(self):
        (self.snapshot/'manifest.json').write_text(json.dumps(self.manifest))
        for state in [{'ready':True,'running':False,'unknown':False},{'ready':False,'running':True,'unknown':False},{'ready':False,'running':False,'unknown':True}]:
            with self.subTest(state=state),patch.object(tools,'remote_status',return_value=state),patch.object(tools.subprocess,'Popen')as start:
                self.assertEqual(tools.remote_start(self.root,self.snapshot,'unused'),state);start.assert_not_called()
    def test_unresolved_start_intent_is_unknown_not_confirmed_idle(self):
        self.assertEqual(tools.owned_process({'state':'starting','pid':None}),(False,True))


if __name__=='__main__':unittest.main()
