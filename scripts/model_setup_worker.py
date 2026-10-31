#!/usr/bin/env python3
"""Tracked explicit facial-tool setup, independent of its SSH observer."""
import argparse
import fcntl
import json
from pathlib import Path
import subprocess
import sys

from model_download_worker import atomic,key_for,process_identity,read


def running(folder):
    value=read(folder/'pid.json');pid=value.get('pid')
    if not isinstance(pid,int)or pid<=1:return False
    try:
        if process_identity(pid)!=value.get('identity'):return False
        args=Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        return b'worker'in args and folder.name.encode()in args and any(a.endswith(b'/model_setup_worker.py')for a in args)
    except FileNotFoundError:return False


def status(folder):
    active=running(folder);result=read(folder/'receipt.json')
    return {'running':active,'complete':bool(result.get('complete')),'error':result.get('error'),
            'requestSHA256':folder.name,'confirmedStopped':not active}


def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['start','status','worker']);p.add_argument('--root',type=Path,required=True);p.add_argument('--request',required=True);p.add_argument('--job');a=p.parse_args()
    root=a.root.resolve();request=json.loads(a.request);version=request.get('version')
    if request.get('kind')!='facial' or version not in [f'source-face-v{n}'for n in range(1,11)]:raise ValueError('Unknown runtime preparation.')
    key=key_for(request);folder=root/'state/module-setups'/key
    if a.job and a.job!=key:raise ValueError('Runtime setup identity changed.')
    if a.action!='status':folder.mkdir(parents=True,exist_ok=True)
    if a.action=='start':
        with(folder/'start.lock').open('a')as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            value=status(folder)
            if not value['running']and not value['complete']:
                atomic(folder/'request.json',request)
                with(folder/'worker.log').open('ab')as log:
                    child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'worker','--root',str(root),'--request',a.request,'--job',key],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
                try:atomic(folder/'pid.json',{'pid':child.pid,'identity':process_identity(child.pid)})
                except FileNotFoundError:pass
            value=status(folder)
    elif a.action=='worker':
        with(folder/'worker.lock').open('a')as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            runtime=root/'facial-runtime/scripts/facial_worker.py'
            try:
                subprocess.run([sys.executable,str(runtime),'prepare','--version',version],check=True)
                atomic(folder/'receipt.json',{'complete':True,'requestSHA256':key})
            except Exception as error:
                log=(folder/'worker.log').read_bytes()[-2500:].decode(errors='replace')if(folder/'worker.log').is_file()else''
                atomic(folder/'receipt.json',{'complete':False,'requestSHA256':key,'error':('Facial tool setup failed. '+log+'\n'+str(error))[-1800:]});raise
        return
    else:value=status(folder)
    print('RECAST_SETUP_STATE '+json.dumps(value),flush=True)


if __name__=='__main__':main()
