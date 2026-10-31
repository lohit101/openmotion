#!/usr/bin/env python3
"""Detached, resumable pinned transfers. No GPU, runtime installation or rentals."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

import download_models as downloader


def read(path):
    try:return json.loads(path.read_text())
    except (OSError,ValueError):return {}


def atomic(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+'.'+str(os.getpid())+'.tmp')
    temp.write_text(json.dumps(value));temp.replace(path)


def key_for(manifest):
    return hashlib.sha256(json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def process_identity(pid):
    # A boot ID + kernel start tick prevents signalling a recycled PID.
    return {'boot':Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
            'start':Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()[19]}


def owns_process(folder):
    saved=read(folder/'pid.json');pid=saved.get('pid')
    if not isinstance(pid,int)or pid<=1:return False
    try:
        if process_identity(pid)!=saved.get('identity'):return False
        args=Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        return b'worker' in args and folder.name.encode() in args and any(b'model_download_worker.py' in a for a in args)
    except FileNotFoundError:return False
    except (OSError,ValueError,IndexError):raise ValueError('The existing model transfer process could not be verified.')


def manifest_for(root,folder):
    manifest=read(folder/'manifest.json')
    if key_for(manifest)!=folder.name or len(manifest.get('files',[]))!=1:raise ValueError('The saved model transfer changed.')
    item=manifest['files'][0];relative=Path(item['destination'])
    if relative.is_absolute()or'..'in relative.parts or not item.get('size',0)>0:raise ValueError('Unsafe model transfer destination.')
    final=root/'models'/relative
    if final.is_symlink()or any(p.is_symlink() for p in final.parents if p!=root.parent):raise ValueError('Refusing a linked model destination.')
    return manifest,item,final


def verified(final,item):
    if not final.is_file()or final.is_symlink():return False
    stat=final.stat()
    return stat.st_size==item['size']and read(final.with_name(final.name+'.verified.json'))=={
        'sha256':item['sha256'],'size':stat.st_size,'mtime_ns':stat.st_mtime_ns}


def status(root,folder):
    manifest,item,final=manifest_for(root,folder);active=owns_process(folder)
    state=read(folder/'progress.json');receipt=read(folder/'receipt.json')
    part=final.with_name(final.name+'.part')
    count=min(item['size'],part.stat().st_size)if part.is_file()and not part.is_symlink()else 0
    phase=state.get('phase','connecting')
    if receipt.get('manifestSHA256')==folder.name and receipt.get('complete')and verified(final,item):
        phase='ready';count=item['size']
    elif not active:
        phase='cancelled'if(folder/'CANCEL').exists()else'failed'
    else:count=max(count,min(item['size'],state.get('downloaded',0)))
    return {'destination':item['destination'],'total':item['size'],'downloaded':count,'phase':phase,
            'bytesPerSecond':state.get('bytesPerSecond'),'error':state.get('error'),
            'running':active,'manifestSHA256':folder.name,'confirmedStopped':not active}


def launch(root,folder,retry=False):
    folder.mkdir(parents=True,exist_ok=True)
    with(folder/'launch.lock').open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        value=status(root,folder)
        if value['running']or value['phase']=='ready':return value
        if not retry:raise ValueError('The saved transfer stopped. Retry downloads explicitly to resume its partial file.')
        (folder/'CANCEL').unlink(missing_ok=True)
        (folder/'receipt.json').unlink(missing_ok=True)
        atomic(folder/'progress.json',{'phase':'connecting','downloaded':value['downloaded']})
        with(folder/'worker.log').open('ab')as log:
            child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'worker','--root',str(root),'--job',folder.name],
                stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
        try:identity=process_identity(child.pid)
        except FileNotFoundError:return status(root,folder)
        atomic(folder/'pid.json',{'pid':child.pid,'identity':identity})
        return status(root,folder)


def cancel(root,folder):
    (folder/'CANCEL').touch()
    if owns_process(folder):
        pid=read(folder/'pid.json')['pid']
        if os.getpgid(pid)!=pid:raise ValueError('The model transfer process group could not be verified.')
        os.killpg(pid,signal.SIGTERM)
        for _ in range(20):
            if not owns_process(folder):break
            time.sleep(.1)
    return status(root,folder)


def run(root,folder):
    manifest,item,final=manifest_for(root,folder)
    with(folder/'worker.lock').open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        def progress(current,count,phase,bytes_per_second=None):
            if(folder/'CANCEL').exists():raise RuntimeError('Model download cancelled. Partial data is retained.')
            atomic(folder/'progress.json',{'phase':phase,'downloaded':count,'bytesPerSecond':bytes_per_second,'updatedAt':time.time()})
        original_report=downloader.report_transfer;original_sleep=downloader.time.sleep;attempt=0
        def retry_wait(seconds):
            nonlocal attempt
            attempt+=1
            old=read(folder/'progress.json');atomic(folder/'progress.json',{**old,'phase':'retrying','attempt':attempt})
            original_sleep(seconds)
        downloader.report_transfer=progress;downloader.time.sleep=retry_wait
        try:
            downloader.download(item,root/'models')
            atomic(folder/'receipt.json',{'complete':True,'manifestSHA256':folder.name,'sha256':item['sha256']})
        except Exception as error:
            old=read(folder/'progress.json');atomic(folder/'progress.json',{**old,'phase':'failed','error':str(error)[-1500:]});raise
        finally:downloader.report_transfer=original_report;downloader.time.sleep=original_sleep


def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['start','status','cancel','worker']);p.add_argument('--root',type=Path,required=True)
    p.add_argument('--job',required=True);p.add_argument('--manifest');p.add_argument('--retry',action='store_true');a=p.parse_args()
    if len(a.job)!=64 or any(c not in '0123456789abcdef'for c in a.job):raise ValueError('Invalid model transfer identity.')
    root=a.root.resolve();folder=root/'state/model-downloads'/a.job
    if a.manifest:
        manifest=json.loads(a.manifest)
        if key_for(manifest)!=a.job:raise ValueError('Model transfer identity does not match its pinned files.')
        folder.mkdir(parents=True,exist_ok=True)
        if(folder/'manifest.json').exists()and read(folder/'manifest.json')!=manifest:raise ValueError('Existing transfer input changed.')
        atomic(folder/'manifest.json',manifest)
        if not owns_process(folder):atomic(folder/'runtime.json',{'script':str(Path(__file__).resolve())})
    if not(folder/'manifest.json').is_file():
        value={'phase':'absent','running':False,'confirmedStopped':True,'manifestSHA256':a.job}
    elif a.action=='worker':run(root,folder);return
    elif a.action=='start':value=launch(root,folder,a.retry)
    elif a.action=='cancel':value=cancel(root,folder)
    else:value=status(root,folder)
    print('RECAST_MODEL_STATE '+json.dumps(value),flush=True)


if __name__=='__main__':main()
