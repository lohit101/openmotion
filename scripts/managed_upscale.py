#!/usr/bin/env python3
"""Clarity transport for the currently connected rental. Never rent/resume."""
import argparse
import json
import os
from pathlib import Path
import shlex
import signal
import subprocess
import tarfile
import tempfile
import time
import uuid

import vast
from managed_models import check_connection
from managed_video_identity import sync
from upscale_worker import ROOT, validate_source, profile_hash, sha

FILES = ['scripts/upscale_worker.py', 'scripts/clarity_video.py', 'scripts/clarity_execution.py', 'config/upscale-runtime.lock.json', 'config/upscale-models.lock.json', 'config/server.json']


def call(config, action, job=None):
    root=Path(config['remote_root'])/'upscale-runtime'
    try:
        value=vast.remote(config,['python3',str(root/'scripts/upscale_worker.py'),action,*(['--job',job]if job else [])],capture_output=True,text=True)
    except subprocess.CalledProcessError as error:
        raise ValueError((error.stderr or error.stdout or 'Clarity remote command failed.')[-2000:])from error
    lines=[line[15:]for line in value.stdout.splitlines()if line.startswith('RECAST_UPSCALE ')]
    if not lines:raise ValueError('Clarity returned no status receipt.')
    return json.loads(lines[-1])


def upload(config):
    root=Path(config['remote_root'])/'upscale-runtime'
    with tempfile.TemporaryFile()as stream:
        with tarfile.open(fileobj=stream,mode='w:gz')as archive:
            for name in FILES:archive.add(ROOT/name,arcname=name,recursive=False)
        stream.seek(0)
        code='''from pathlib import Path
import tarfile,sys,tempfile,os,shutil
r=Path(sys.argv[1]);r.mkdir(parents=True,exist_ok=True)
if r.is_symlink():raise ValueError('Unexpected linked Clarity runtime')
s=Path(tempfile.mkdtemp(dir=r))
try:
 with tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz')as a:
  names=[]
  for m in a:
   p=Path(m.name)
   if p.is_absolute()or'..'in p.parts or not m.isfile()or(r/p).is_symlink():raise ValueError('Unsafe Clarity runtime file')
   a.extract(m,s,filter='data');names.append(p)
 for p in names:
  (r/p).parent.mkdir(parents=True,exist_ok=True);os.replace(s/p,r/p)
 (r/'state').mkdir(exist_ok=True)
finally:shutil.rmtree(s)
'''
        vast.remote(config,['python3','-c',code,str(root)],stdin=stream)


def main():
    p=argparse.ArgumentParser();p.add_argument('--action',choices=['status','prepare','run','recover','cancel'],required=True);p.add_argument('--instance-id',type=int,required=True)
    p.add_argument('--job');p.add_argument('--source');p.add_argument('--request');p.add_argument('--output');a=p.parse_args()
    config=vast.load();check_connection(config,a.instance_id);os.environ['RECAST_SSH_BATCH']='1';root=Path(config['remote_root'])/'upscale-runtime'
    probe=subprocess.run(vast.ssh_arguments(config)+['-T',vast.destination(config),shlex.join(['test','-f',str(root/'scripts/upscale_worker.py')])],capture_output=True)
    if probe.returncode not in (0,1):raise ValueError('Could not verify Clarity on the connected GPU. Existing remote activity remains unconfirmed.')
    exists=probe.returncode==0
    if a.action=='status':
        value=call(config,'status')if exists else {'ready':False,'preparing':False,'missing':['Clarity runtime'],'modelBytes':7016472997,'runtimeReserveBytes':10737418240}
        if value.get('profileSHA256')!=profile_hash():value.update(ready=False,missing=[*value.get('missing',[]),'Updated Clarity tools'])
        print('RECAST_UPSCALE '+json.dumps(value));return
    if a.action=='prepare':
        if exists:
            previous=call(config,'status')
            if previous.get('preparing')or previous.get('processing'):raise ValueError('Finish or check existing Clarity work before updating tools.')
        upload(config);value=call(config,'prepare')
        while value.get('preparing'):
            print(json.dumps({'stage':'Preparing isolated Clarity runtime'}),flush=True)
            time.sleep(2);value=call(config,'status')
        if value.get('error'):raise ValueError(value['error'])
        print('RECAST_UPSCALE '+json.dumps(value));return
    job=str(uuid.UUID(a.job));folder=root/'jobs'/job
    if a.action=='cancel':
        if not exists:print('RECAST_UPSCALE '+json.dumps({'running':False,'state':'absent'}));return
        for _ in range(15):
            value=call(config,'cancel',job)
            if value.get('running')is False:print('RECAST_UPSCALE '+json.dumps(value));return
            time.sleep(1)
        raise ValueError('Clarity cancellation is unconfirmed. Keep the same GPU connected and check again.')
    if not exists:raise ValueError('Prepare Clarity explicitly before upscaling.')
    if not a.output or not a.request:raise ValueError('Saved upscale request and output folder are required.')
    request=json.loads(Path(a.request).read_text())
    if request.get('jobId')!=job or a.action=='run'and request.get('profileSHA256')!=profile_hash():raise ValueError('Saved Clarity recipe changed.')
    output=Path(a.output).resolve();output.mkdir(parents=True,exist_ok=True)
    cancelled=False
    def cancel(_s,_f):
        nonlocal cancelled
        cancelled=True
    signal.signal(signal.SIGTERM,cancel);signal.signal(signal.SIGINT,cancel)
    if a.action=='run':
        if not a.source:raise ValueError('Original video is required.')
        if sha(a.source)!=request['sourceSHA256']or validate_source(a.source)!=request['input']:raise ValueError('Original video changed.')
        tools=call(config,'status')
        if tools.get('preparing')or tools.get('processing'):raise ValueError('Finish or check existing Clarity work first.')
        if not tools['ready']or tools['profileSHA256']!=profile_hash():raise ValueError('Prepare the selected Clarity tools explicitly. Nothing was downloaded.')
        vast.remote(config,['mkdir','-p',str(folder)])
        code='''from pathlib import Path
import json,sys
p=Path(sys.argv[1]);v=json.loads(sys.argv[2])
if p.exists()and json.loads(p.read_text())!=v:raise ValueError('Existing upscale request changed')
if not p.exists():p.write_text(json.dumps(v))
'''
        vast.remote(config,['python3','-c',code,str(folder/'request.json'),json.dumps(request)])
        sync(config,str(Path(a.source).resolve()),str(folder/'source.video'))
        if cancelled:call(config,'cancel',job);raise ValueError('Clarity cancelled before inference.')
        call(config,'launch',job)
    sent=False
    while True:
        if cancelled and not sent:call(config,'cancel',job);sent=True
        value=call(config,'poll',job)
        print(json.dumps({'progress':value.get('progress',0),'stage':value.get('stage','Checking saved upscale'),'frames':value.get('frames',0)}),flush=True)
        if not value.get('running'):
            print('RECAST_UPSCALE_STOPPED',flush=True)
            if cancelled:raise ValueError('Clarity cancelled. Source and partial output remain saved.')
            if value.get('complete'):break
            raise ValueError(value.get('error')or'No completed upscale is available. Use Retry to explicitly start a new attempt.')
        time.sleep(1)
    for name in ['receipt.json','final.mp4']:sync(config,str(folder/'result'/name),str(output/name),download=True)
    receipt=json.loads((output/'receipt.json').read_text())
    if not receipt.get('complete')or receipt.get('request')!=request or sha(output/'final.mp4')!=receipt.get('outputSHA256'):raise ValueError('Upscale checksum or input receipt failed validation.')
    (output/'transport.json').write_text(json.dumps({'instanceId':a.instance_id,'jobId':job,'receiptSHA256':sha(output/'receipt.json')}))
    print('RECAST_UPSCALE '+json.dumps({k:v for k,v in receipt.items()if k!='request'}))


if __name__=='__main__':
    try:main()
    except (OSError,ValueError,subprocess.SubprocessError)as e:raise SystemExit(str(e))
