"""Xet transport and ownership contracts. Synthetic streams; no model host/GPU."""
import contextlib
from concurrent.futures import ThreadPoolExecutor
import errno
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import download_models as downloader
import xet_download as xet
import model_download_worker as worker
import managed_model_download as managed


class XetDownloadTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name).resolve()
        self.data = bytes(range(256)) * 1024
        self.item = dict(repo='owner/model', revision='a'*40, filename='original/weights.bin', destination='diffusion_models/renamed.bin', size=len(self.data), sha256=hashlib.sha256(self.data).hexdigest())
        self.part = self.root / 'weights.part'
        self.meta = SimpleNamespace(size=len(self.data), commit_hash='a'*40, etag=self.item['sha256'], xet_file_data=SimpleNamespace(file_hash='cas-hash', refresh_route='https://huggingface.co/api/models/owner/model/xet-read-token/'+'a'*40))
        self.ranges = []; self.groups = []; self.fail_once = False; self.fail_always = False
        self.headers = []
        test = self
        class Group:
            def __enter__(self): return self
            def __exit__(self, kind, *_args): self.aborted = kind is not None
            def download_stream(self, info, *, start, end):
                test.ranges.append((info, start, end))
                for offset in range(start, end, 65536):
                    if (test.fail_once or test.fail_always) and offset > start:
                        test.fail_once = False
                        raise OSError('https://signed.example/?token=SECRET')
                    yield test.data[offset:min(offset+65536,end)]
        class Session:
            def new_download_stream_group(self, **kwargs):
                group = Group(); group.kwargs = kwargs; test.groups.append(group); return group
        def headers(**kwargs):
            test.headers.append(kwargs); return {'Authorization':'Bearer SECRET', 'User-Agent':'test'}
        self.hub = SimpleNamespace(get_hf_file_metadata=lambda *_a,**_kw:self.meta, hf_hub_url=lambda repo,name,revision:'https://huggingface.co/'+repo+'/resolve/'+revision+'/'+name)
        self.modules = {'hf_xet':SimpleNamespace(XetFileInfo=lambda h,s:(h,s), XetSession=Session), 'huggingface_hub':self.hub, 'huggingface_hub.utils':SimpleNamespace(build_hf_headers=headers)}

    def tearDown(self): self.temp.cleanup()

    def native(self): return patch.dict(sys.modules, self.modules)

    def managed_stream(self, item, part, report):
        return xet.stream_download(item,part,report,required=True)

    def test_ordered_xet_range_appends_to_existing_http_prefix(self):
        self.part.write_bytes(self.data[:12345]); progress=[]
        with self.native(): self.assertTrue(xet.stream_download(self.item,self.part,lambda *a:progress.append(a)))
        self.assertEqual(self.part.read_bytes(), self.data)
        self.assertEqual(self.ranges[0][1:], (12345,len(self.data)))
        self.assertEqual(progress[-1][1],len(self.data))
        self.assertFalse(self.groups[0].aborted)
        self.assertEqual(self.groups[0].kwargs['token_refresh_headers']['Authorization'],'Bearer SECRET')
        self.assertNotIn('Authorization',self.groups[0].kwargs['custom_headers'])

    def test_full_downloader_retries_xet_from_actual_bytes_then_verifies_and_renames(self):
        self.fail_once=True
        with self.native(), patch.object(downloader.time,'sleep'), contextlib.redirect_stdout(io.StringIO()), patch.object(downloader.urllib.request,'build_opener') as http:
            final=downloader.download(self.item,self.root,stream_download=self.managed_stream)
        self.assertEqual(final.read_bytes(),self.data)
        self.assertEqual([r[1] for r in self.ranges],[0,65536])
        self.assertFalse(http.return_value.open.called)
        self.assertTrue(downloader.valid_file(final,self.item))
        self.assertFalse(final.with_name(final.name+'.part').exists())
        self.assertEqual(list(self.root.rglob('*.bin')), [final])

    def test_failed_native_transfer_retains_a_real_contiguous_prefix_and_redacts_urls(self):
        self.fail_always=True
        with self.native(), self.assertRaisesRegex(xet.XetDownloadError,'saved bytes') as error:
            xet.stream_download(self.item,self.part,lambda *_a:None)
        self.assertNotIn('SECRET',str(error.exception))
        self.assertNotIn('SECRET',''.join(traceback.format_exception(type(error.exception),error.exception,error.exception.__traceback__)))
        self.assertEqual(self.part.read_bytes(),self.data[:65536]); self.assertTrue(self.groups[0].aborted)

    def test_progress_cancellation_is_not_retried_as_a_network_error(self):
        def cancel(*_a): raise RuntimeError('Model download cancelled.')
        with self.native(), self.assertRaisesRegex(RuntimeError,'cancelled'):
            xet.stream_download(self.item,self.part,cancel)
        self.assertEqual(len(self.groups),1);self.assertTrue(self.groups[0].aborted)

    def test_disk_full_is_actionable_and_preserves_the_existing_prefix(self):
        self.part.write_bytes(self.data[:12345])
        with self.native(),patch.object(Path,'open',side_effect=OSError(errno.ENOSPC,'No space left')), \
             self.assertRaisesRegex(xet.XetAccessError,'disk is full'):
            xet.stream_download(self.item,self.part,lambda *_a:None)
        self.assertEqual(self.part.read_bytes(),self.data[:12345]);self.assertTrue(self.groups[0].aborted)

    def test_restricted_cpu_affinity_probe_uses_the_portable_fallback(self):
        with patch.dict(os.environ,{},clear=True),patch.object(xet.os,'sched_getaffinity',side_effect=OSError('restricted'),create=True), \
             patch.object(xet.os,'cpu_count',return_value=2),patch.object(xet,'host_memory',return_value=1024**3):
            self.assertEqual(xet.tune_xet()['HF_XET_NUM_CONCURRENT_RANGE_GETS'],'4')

    def test_metadata_must_match_revision_size_and_sha_before_writing(self):
        for key,value in [('commit_hash','b'*40),('size',10),('etag','wrong')]:
            with self.subTest(key=key):
                previous=getattr(self.meta,key);setattr(self.meta,key,value)
                self.part.write_bytes(b'preserve')
                with self.native(), self.assertRaises(xet.XetAccessError): xet.stream_download(self.item,self.part,lambda *_a:None)
                self.assertEqual(self.part.read_bytes(),b'preserve');setattr(self.meta,key,previous)
        self.assertFalse(self.groups)

    def test_non_xet_file_returns_to_existing_http_without_touching_prefix(self):
        self.meta.xet_file_data=None;self.part.write_bytes(b'prefix')
        with self.native():self.assertFalse(xet.stream_download(self.item,self.part,lambda *_a:None))
        self.assertEqual(self.part.read_bytes(),b'prefix');self.assertFalse(self.groups)

    def test_access_failure_is_terminal_and_does_not_expose_tokens(self):
        class Denied(Exception): response=SimpleNamespace(status_code=403)
        def denied(*_a,**_kw):raise Denied('signed SECRET')
        self.hub.get_hf_file_metadata=denied
        with self.native(),self.assertRaisesRegex(xet.XetAccessError,'HTTP 403') as error:xet.stream_download(self.item,self.part,lambda *_a:None)
        self.assertNotIn('SECRET',str(error.exception));self.assertFalse(self.part.exists())

    def test_credential_refresh_cannot_leave_the_hub(self):
        for route in ['https://other.example/token','http://huggingface.co/token','https://huggingface.co@other.example/token']:
            self.meta.xet_file_data.refresh_route=route
            with self.native(),self.assertRaisesRegex(xet.XetAccessError,'credential'):xet.stream_download(self.item,self.part,lambda *_a:None)
        self.assertFalse(self.groups)

    def test_oversized_stream_is_never_published(self):
        self.data+=b'bad'
        # Full-size contract plus a deliberately oversized last native chunk.
        class BadGroup:
            def __enter__(self):return self
            def __exit__(self,*_a):pass
            def download_stream(inner,*_a,**_kw):yield self.data
        self.modules['hf_xet'].XetSession=lambda:SimpleNamespace(new_download_stream_group=lambda **kw:BadGroup())
        with self.native(),self.assertRaisesRegex(xet.XetAccessError,'more bytes'):xet.stream_download(self.item,self.part,lambda *_a:None)
        self.assertEqual(self.part.stat().st_size,0)

    def test_pin_checksum_still_rejects_corrupt_download_bytes(self):
        self.data=b'X'*len(self.data)
        with self.native(),patch.object(downloader.time,'sleep'),contextlib.redirect_stdout(io.StringIO()),self.assertRaisesRegex(RuntimeError,'SHA256'):
            downloader.download(self.item,self.root,retries=1,stream_download=self.managed_stream)
        self.assertFalse((self.root/self.item['destination']).exists())
        self.assertFalse((self.root/(self.item['destination']+'.part')).exists())

    def test_tuning_is_bounded_for_host_memory_and_keeps_explicit_overrides(self):
        with patch.dict(os.environ,{},clear=True),patch.object(xet,'host_memory',return_value=2*1024**3),patch.object(xet.os,'cpu_count',return_value=128):
            values=xet.tune_xet()
            self.assertEqual(values['HF_XET_HIGH_PERFORMANCE'],'1')
            self.assertEqual(values['HF_XET_CHUNK_CACHE_SIZE_BYTES'],'0')
            self.assertLessEqual(int(values['HF_XET_RECONSTRUCTION_DOWNLOAD_BUFFER_PERFILE_SIZE']),32*1024**2)
            self.assertLessEqual(int(values['HF_XET_NUM_CONCURRENT_RANGE_GETS']),16)
        with patch.dict(os.environ,{'HF_XET_NUM_CONCURRENT_RANGE_GETS':'6'},clear=True):self.assertEqual(xet.tune_xet()['HF_XET_NUM_CONCURRENT_RANGE_GETS'],'6')

    def test_custom_sources_and_invalid_pins_do_not_go_to_xet(self):
        self.assertTrue(xet.hf_source(self.item))
        for delta in [{'url':'https://example.com/file'},{'revision':'main'},{'repo':'../model'},{'filename':'../model.bin'}]:
            self.assertFalse(xet.hf_source({**self.item,**delta}))

    def test_missing_client_is_optional_only_for_legacy_helpers(self):
        with patch.dict(sys.modules,{'hf_xet':None}):
            self.assertFalse(xet.stream_download(self.item,self.part,lambda *_a:None))
            with self.assertRaisesRegex(xet.XetAccessError,'client is unavailable'):
                xet.stream_download(self.item,self.part,lambda *_a:None,required=True)

    def test_runtime_bundle_fingerprint_includes_the_pinned_client(self):
        self.assertIn('scripts/xet_download.py',managed.FILES)
        self.assertIn('config/model-download-runtime.lock.json',managed.FILES)
        for name in managed.FILES:
            target=self.root/name;target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes((managed.ROOT/name).read_bytes())
        with patch.object(managed,'ROOT',self.root):
            first=managed.runtime_path({'remote_root':'/workspace/test'})
            lock=self.root/'config/model-download-runtime.lock.json';spec=json.loads(lock.read_text())
            spec['requirements'][1]='hf_xet==9.9.9';lock.write_text(json.dumps(spec))
            second=managed.runtime_path({'remote_root':'/workspace/test'})
        self.assertNotEqual(first,second)

    def test_worker_reexec_keeps_the_exact_saved_attempt_and_no_second_process(self):
        manifest={'files':[self.item],'total_bytes':self.item['size']};key=worker.key_for(manifest)
        folder=self.root/'state/model-downloads'/key;folder.mkdir(parents=True)
        worker.atomic(folder/'manifest.json',manifest)
        python=self.root/'isolated-client/bin/python';argv=['model_download_worker.py','worker','--root',str(self.root),'--job',key]
        class ExecReplaced(BaseException):pass
        with patch.object(sys,'argv',argv),patch.object(xet,'client_python',return_value=python), \
             patch.object(worker.os,'execv',side_effect=ExecReplaced) as execute,patch.object(worker.subprocess,'Popen') as spawn, \
             patch.object(worker.downloader,'download') as download,self.assertRaises(ExecReplaced):
            worker.run(self.root,folder)
        self.assertEqual(execute.call_args.args,(str(python),[str(python),str(Path(worker.__file__).resolve()),*argv[1:]]))
        spawn.assert_not_called();download.assert_not_called()
        self.assertFalse((folder/'receipt.json').exists())

    def test_verified_existing_model_does_not_install_the_download_client(self):
        manifest={'files':[self.item]};folder=self.root/'state/model-downloads'/worker.key_for(manifest);folder.mkdir(parents=True)
        worker.atomic(folder/'manifest.json',manifest)
        final=self.root/'models'/self.item['destination'];final.parent.mkdir(parents=True);final.write_bytes(self.data)
        self.assertTrue(downloader.valid_file(final,self.item))
        with patch.object(xet,'client_python') as provision,contextlib.redirect_stdout(io.StringIO()):worker.run(self.root,folder)
        provision.assert_not_called();self.assertTrue(worker.read(folder/'receipt.json')['complete'])

    def test_xet_setup_is_isolated_from_comfy_and_concurrent_workers_share_one_install(self):
        spec={'version':'test','requirements':['huggingface_hub==2.4.0','hf_xet==1.8.0']}
        lock=self.root/'config/model-download-runtime.lock.json';lock.parent.mkdir();lock.write_text(json.dumps(spec))
        client=self.root/'xet-client';python=client/'bin/python'
        def install(command,**kw):
            if 'venv' in command:
                time.sleep(.05);python.parent.mkdir(parents=True);python.touch()
        barrier=threading.Barrier(4)
        def prepare():
            barrier.wait();return xet.client_python(self.root)
        with patch.object(xet,'RUNTIME',self.root),patch.object(xet,'LOCK',lock),patch.object(xet.subprocess,'run',side_effect=install) as run:
            with ThreadPoolExecutor(max_workers=4) as pool:self.assertEqual(list(pool.map(lambda _:prepare(),range(4))),[python]*4)
        pip_calls=[c.args[0] for c in run.call_args_list if 'pip' in c.args[0]]
        self.assertEqual(len(pip_calls),1);pip=pip_calls[0]
        self.assertIn('--only-binary=:all:',pip);self.assertTrue(str(python) in pip)
        self.assertNotIn(str(self.root/'.venv/bin/python'),pip)


if __name__=='__main__':unittest.main()
