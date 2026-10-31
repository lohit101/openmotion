"""Local HTTP/CPU transfer fixtures only; never contacts a GPU or model host."""
import contextlib
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import model_download_worker as worker
import managed_model_download as managed


class DownloadRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name).resolve()
        self.body=bytes(range(256))*4096;self.ranges=[];self.drop_at=[None]
        body=self.body;ranges=self.ranges;drop_at=self.drop_at
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                value=self.headers.get('Range');ranges.append(value);offset=int(value.split('=')[1].split('-')[0])if value else 0
                self.send_response(206 if value else 200)
                if value:self.send_header('Content-Range',f'bytes {offset}-{len(body)-1}/{len(body)}')
                self.send_header('Content-Length',str(len(body)-offset));self.end_headers()
                if drop_at[0] is not None:
                    count=drop_at[0];drop_at[0]=None;self.wfile.write(body[offset:offset+count]);self.wfile.flush();self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                self.wfile.write(body[offset:])
            def log_message(self,*_args):pass
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler);self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.item={'destination':'loras/test.safetensors','filename':'test.safetensors','size':len(body),'sha256':hashlib.sha256(body).hexdigest(),'url':f'http://127.0.0.1:{self.server.server_port}/data'}
        self.manifest={'files':[self.item],'total_bytes':len(body)};self.key=worker.key_for(self.manifest)
        self.folder=self.root/'state/model-downloads'/self.key;self.folder.mkdir(parents=True)
        worker.atomic(self.folder/'manifest.json',self.manifest)

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()

    def test_detached_journal_resumes_exact_bytes_and_checks_completion_identity(self):
        final=self.root/'models'/self.item['destination'];final.parent.mkdir(parents=True);final.with_name(final.name+'.part').write_bytes(self.body[:12345])
        with contextlib.redirect_stdout(io.StringIO()):worker.run(self.root,self.folder)
        self.assertEqual(self.ranges,['bytes=12345-']);self.assertEqual(final.read_bytes(),self.body)
        with patch.object(worker,'owns_process',return_value=False):value=worker.status(self.root,self.folder)
        self.assertEqual(value['phase'],'ready');self.assertEqual(value['downloaded'],len(self.body));self.assertTrue(value['confirmedStopped'])
        final.write_bytes(b'x'*len(self.body))
        with patch.object(worker,'owns_process',return_value=False):self.assertEqual(worker.status(self.root,self.folder)['phase'],'failed')

    def test_duplicate_start_attaches_without_spawning_another_download(self):
        with patch.object(worker,'owns_process',return_value=True),patch.object(worker.subprocess,'Popen')as spawn:
            value=worker.launch(self.root,self.folder,retry=True)
            self.assertTrue(value['running']);spawn.assert_not_called()

    def test_mid_transfer_network_loss_retries_the_saved_range(self):
        self.drop_at[0]=512*1024
        with patch.object(worker.downloader.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):worker.run(self.root,self.folder)
        final=self.root/'models'/self.item['destination']
        self.assertEqual(self.ranges,[None,'bytes=524288-']);self.assertEqual(final.read_bytes(),self.body)
        self.assertTrue(worker.verified(final,self.item))

    def test_recovery_never_restarts_a_stopped_or_cancelled_transfer_implicitly(self):
        with patch.object(worker,'owns_process',return_value=False),patch.object(worker.subprocess,'Popen')as spawn:
            with self.assertRaisesRegex(ValueError,'explicitly'):worker.launch(self.root,self.folder)
            spawn.assert_not_called()

    def test_cancel_signals_only_the_verified_worker_process_group(self):
        worker.atomic(self.folder/'pid.json',{'pid':99887})
        with patch.object(worker,'owns_process',side_effect=[True,False,False]),patch.object(worker.os,'getpgid',return_value=99887),patch.object(worker.os,'killpg')as kill:
            value=worker.cancel(self.root,self.folder);kill.assert_called_once_with(99887,signal.SIGTERM)
            self.assertTrue(value['confirmedStopped']);self.assertEqual(value['phase'],'cancelled')
        with patch.object(worker,'owns_process',return_value=False),patch.object(worker.os,'killpg')as kill:
            worker.cancel(self.root,self.folder);kill.assert_not_called()

    def test_mismatched_manifest_and_linked_model_directories_are_rejected(self):
        worker.atomic(self.folder/'manifest.json',{**self.manifest,'total_bytes':123})
        with self.assertRaisesRegex(ValueError,'changed'):worker.manifest_for(self.root,self.folder)
        worker.atomic(self.folder/'manifest.json',self.manifest)
        target=self.root/'elsewhere';target.mkdir();(self.root/'models').symlink_to(target,target_is_directory=True)
        with self.assertRaisesRegex(ValueError,'linked'):worker.manifest_for(self.root,self.folder)

    def test_ssh_outage_reconnects_to_the_existing_job_without_another_start(self):
        state={'manifestSHA256':self.key,'destination':self.item['destination'],'total':len(self.body),'downloaded':400,'phase':'downloading','running':True,'confirmedStopped':False}
        ready={**state,'downloaded':len(self.body),'phase':'ready','running':False,'confirmedStopped':True}
        actions=[];out=io.StringIO()
        def call(_config,_script,action,_key,manifest=None):
            actions.append(action)
            if len(actions)==2:raise subprocess.CalledProcessError(255,['ssh'])
            return ready if len(actions)>2 else state
        with patch.object(managed,'upload',return_value=Path('/runtime/worker.py')),patch.object(managed,'call',side_effect=call),patch.object(managed.signal,'signal'),contextlib.redirect_stdout(out):
            self.assertTrue(managed.transfer({'remote_root':'/workspace/test'},self.manifest,sleep=lambda _n:None))
        self.assertEqual(actions,['start','status','status']);self.assertIn('reconnecting',out.getvalue());self.assertIn('RECAST_MODEL_STOPPED',out.getvalue())

    def test_restart_recovery_is_read_only_and_does_not_upload_or_start(self):
        ready={'manifestSHA256':self.key,'destination':self.item['destination'],'total':len(self.body),'downloaded':len(self.body),'phase':'ready','running':False,'confirmedStopped':True}
        with patch.object(managed,'locate',return_value=Path('/old-runtime/worker.py')),patch.object(managed,'upload')as upload,patch.object(managed,'call',return_value=ready)as call,patch.object(managed.signal,'signal'),contextlib.redirect_stdout(io.StringIO()):
            self.assertTrue(managed.transfer({'remote_root':'/workspace/test'},self.manifest,recover=True,sleep=lambda _n:None))
            upload.assert_not_called();self.assertEqual(call.call_args.args[2],'status')

    def test_unknown_cancel_does_not_claim_stopped_and_has_a_bounded_check(self):
        out=io.StringIO()
        with patch.object(managed,'locate',return_value=Path('/old-runtime/worker.py')),patch.object(managed,'call',side_effect=OSError('network down'))as call,patch.object(managed.signal,'signal'),contextlib.redirect_stdout(out):
            with self.assertRaisesRegex(RuntimeError,'unconfirmed'):
                managed.transfer({'remote_root':'/workspace/test'},self.manifest,recover=True,cancel_requested=True,sleep=lambda _n:None)
            self.assertEqual(call.call_count,3)
        self.assertNotIn('RECAST_MODEL_STOPPED',out.getvalue())

    def test_runtime_upload_uses_a_real_descriptor_and_safe_archive(self):
        def remote(_config,args,stdin,timeout):
            self.assertGreaterEqual(stdin.fileno(),0)
            compile(args[2],'remote-upload','exec')
            import tarfile
            with tarfile.open(fileobj=stdin,mode='r:gz')as archive:
                self.assertEqual(archive.getnames(),managed.FILES)
        with patch.object(managed.vast,'remote',side_effect=remote):
            result=managed.upload({'remote_root':'/workspace/test'})
        self.assertEqual(result.name,'model_download_worker.py')

    def test_local_identity_adapter_resumes_without_editing_the_legacy_setup(self):
        import prepare_local_models as local
        from types import SimpleNamespace
        import urllib.request
        config={'source_directory':'local-source','files':[{**self.item,'path':'assets/models/local.onnx'}]}
        lock=self.root/'local.json';lock.write_text(json.dumps(config));final=self.root/'local-source/assets/models/local.onnx';final.parent.mkdir(parents=True)
        final.with_name(final.name+'.part').write_bytes(self.body[:22222])
        def legacy_setup():
            with urllib.request.urlopen(self.item['url'])as response,final.with_name(final.name+'.part').open('wb')as out:out.write(response.read())
            final.with_name(final.name+'.part').replace(final)
            return {'ready':True}
        fake=SimpleNamespace(LOCK=lock,setup=legacy_setup,digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest())
        with patch.object(local,'ROOT',self.root),patch.object(local,'local_identity',fake),contextlib.redirect_stdout(io.StringIO())as out:
            self.assertTrue(local.prepare('localIdentity')['ready'])
        self.assertEqual(final.read_bytes(),self.body);self.assertEqual(self.ranges,['bytes=22222-'])
        self.assertIn('RECAST_LOCAL_MODEL_PROGRESS',out.getvalue())

    def test_tracked_runtime_launch_has_a_verifiable_job_argument(self):
        import model_setup_worker as setup
        request={'kind':'facial','version':'source-face-v7','profile':'test','attempt':'test'};key=worker.key_for(request)
        with patch.object(sys,'argv',['model_setup_worker.py','start','--root',str(self.root),'--request',json.dumps(request)]), \
             patch.object(setup,'running',side_effect=[False,True]),patch.object(setup,'process_identity',return_value={'boot':'b','start':'1'}), \
             patch.object(setup.subprocess,'Popen',return_value=type('Child',(),{'pid':99887})())as spawn,contextlib.redirect_stdout(io.StringIO()):
            setup.main()
        args=spawn.call_args.args[0];self.assertIn(key,args);self.assertIn('--job',args)

    def test_runtime_lost_start_response_only_polls_the_same_attempt(self):
        import managed_model_setup as setup
        actions=[];requests=[]
        def remote(_config,args,**_kwargs):
            action=args[2];request=json.loads(args[args.index('--request')+1]);actions.append(action);requests.append(request)
            if action=='start':raise subprocess.CalledProcessError(255,['ssh'])
            value={'requestSHA256':worker.key_for(request),'confirmedStopped':True,'complete':True}
            return type('Result',(),{'stdout':'RECAST_SETUP_STATE '+json.dumps(value)})()
        with patch.object(setup,'upload',return_value=Path('/runtime/model_download_worker.py')),patch.object(setup.vast,'remote',side_effect=remote),patch.object(setup.time,'sleep'),contextlib.redirect_stdout(io.StringIO()):
            setup.prepare({'remote_root':'/workspace/test'},'source-face-v7','test')
        self.assertEqual(actions,['start','status']);self.assertEqual(requests[0],requests[1])

    def test_inventory_runtime_observation_is_valid_python_and_read_only(self):
        import managed_models
        captured=[]
        def remote(_config,args,**_kwargs):captured.append(args)
        config={'instance_id':123,'local_port':8188,'remote_root':'/workspace/character-swap'}
        with patch.object(sys,'argv',['managed_models.py','--action','inventory','--instance-id','123']),patch.object(managed_models.vast,'load',return_value=config),patch.object(managed_models.vast,'remote',side_effect=remote):
            managed_models.main()
        self.assertEqual(len(captured),1);compile(captured[0][2],'inventory-probe','exec');self.assertIn('facialPreparing',captured[0][2]);self.assertNotIn('pip install',captured[0][2])

    def test_cli_batch_selection_keeps_individual_transfer_identities(self):
        import managed_models
        from model_manifest import selected_manifest
        ids=[item['destination']for item in selected_manifest()['files'][:2]]
        config={'instance_id':123,'local_port':8188,'remote_root':'/workspace/character-swap'}
        with patch.object(sys,'argv',['managed_models.py','--instance-id','123','--model-files',json.dumps(ids)]),patch.object(managed_models.vast,'load',return_value=config),patch.object(managed,'transfer',return_value=True)as transfer,patch.object(managed_models,'register_download_paths'):
            managed_models.main()
        self.assertEqual([call.args[1]for call in transfer.call_args_list],[selected_manifest([id])for id in ids])


if __name__=='__main__':unittest.main()
