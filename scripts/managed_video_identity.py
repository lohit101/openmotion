#!/usr/bin/env python3
"""Face refinement on an already connected rental. Never starts/rents compute."""
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
from local_identity import ROOT, digest
from managed_models import check_connection
from video_identity import video_info


def remote(config, action, job=None, capture=True):
    root=Path(config['remote_root'])/'face-refinement-runtime'
    args=['python3',str(root/'scripts/gpu_identity_worker.py'),action]
    if job: args.extend(['--job',job])
    value=vast.remote(config,args,capture_output=capture,text=True)
    if not capture: return None
    rows=[line[len('RECAST_FACE '):] for line in value.stdout.splitlines() if line.startswith('RECAST_FACE ')]
    if not rows: raise ValueError('GPU refinement returned no status receipt.')
    return json.loads(rows[-1])


def sync(config, source, destination, download=False):
    if not shutil_which('rsync'): raise ValueError('Install rsync before using GPU face refinement.')
    address=vast.destination(config)
    command=['rsync','-a','--partial','--checksum','-e',shlex.join(vast.ssh_arguments(config))]
    command += [address+':'+source,destination] if download else [source,address+':'+destination]
    subprocess.run(command,check=True)


def shutil_which(name):
    import shutil
    return shutil.which(name)


FACE_REFINEMENT_RUNTIME_FILES = (
    'scripts/local_identity.py', 'scripts/model_manifest.py', 'scripts/video_identity.py', 'scripts/video_timing.py',
    'scripts/source_face_performance.py', 'scripts/gpu_identity_worker.py', 'scripts/download_models.py',
    'config/face-source-profile.json', 'config/local-identity.lock.json', 'config/local-video-identity.lock.json',
    'config/gpu-video-identity.lock.json', 'config/server.json',
)


def upload_runtime(config):
    root=str(Path(config['remote_root'])/'face-refinement-runtime')
    names=FACE_REFINEMENT_RUNTIME_FILES
    with tempfile.TemporaryFile() as stream:
        with tarfile.open(fileobj=stream,mode='w:gz') as archive:
            for name in names: archive.add(ROOT/name,arcname=name,recursive=False)
        stream.seek(0)
        command='mkdir -p '+shlex.quote(root)+' && tar -xzf - -C '+shlex.quote(root)
        subprocess.run(vast.ssh_arguments(config)+['-T',vast.destination(config),command],stdin=stream,check=True)


def main():
    p=argparse.ArgumentParser();p.add_argument('--instance-id',type=int,required=True);p.add_argument('--action',choices=['status','setup','run'],required=True)
    p.add_argument('--job');p.add_argument('--reference');p.add_argument('--target');p.add_argument('--output');p.add_argument('--method',choices=['direct','source-performance'],default='direct');p.add_argument('--performance-source');a=p.parse_args()
    config=vast.load();check_connection(config,a.instance_id);os.environ['RECAST_SSH_BATCH']='1'
    root=Path(config['remote_root'])/'face-refinement-runtime'
    if a.action=='status':
        # A read must never upload code, install dependencies or start compute.
        exists=subprocess.run(vast.ssh_arguments(config)+['-T',vast.destination(config),shlex.join(['test','-f',str(root/'scripts/gpu_identity_worker.py')])],capture_output=True)
        if exists.returncode:
            print('RECAST_FACE '+json.dumps({'ready':False,'missing':['GPU face runtime'],'bytes':1292800048,'readyBytes':0}));return
        print('RECAST_FACE '+json.dumps(remote(config,'status')));return
    if a.action=='setup':
        upload_runtime(config);remote(config,'setup',capture=False);return
    if not all([a.job,a.reference,a.target,a.output]): raise ValueError('Job and immutable input/output paths are required.')
    job=str(uuid.UUID(a.job));output=Path(a.output).resolve();output.mkdir(parents=True,exist_ok=True)
    target=Path(a.target).resolve();reference=Path(a.reference).resolve();folder=root/'jobs'/job
    tools=remote(config,'status')
    if not tools['ready']: raise ValueError('Click Prepare GPU refinement first. Generate never downloads models.')
    if a.method=='source-performance' and (not a.performance_source or tools.get('performanceProfile')!=digest(ROOT/'config/face-source-profile.json')):
        raise ValueError('Update GPU face tools explicitly before source-performance swapping. No model or runtime download was started.')
    info=video_info(target)
    inputs={'parentSHA256':digest(target),'referenceSHA256':digest(reference),'workingBytes':5*1024**3+int(info['frames']*info['width']*info['height']*3*1.2)}
    if a.method=='source-performance':
        performance_source=Path(a.performance_source).resolve()
        if video_info(performance_source)!=info:raise ValueError('Performance source timing or dimensions do not match the completed video.')
        inputs.update(method=a.method,performanceSHA256=digest(performance_source),performanceProfile=digest(ROOT/'config/face-source-profile.json'))
    vast.remote(config,['mkdir','-p',str(folder)])
    # Inputs are stable per job. Rsync resumes partial transfers and checksums
    # existing files instead of sending full frame caches back to the Mac.
    sync(config,str(target),str(folder/'target.mp4'));sync(config,str(reference),str(folder/'reference.png'))
    if a.method=='source-performance':sync(config,str(performance_source),str(folder/'performance.mp4'))
    with tempfile.TemporaryDirectory() as temp:
        file=Path(temp)/'inputs.json';file.write_text(json.dumps(inputs));sync(config,str(file),str(folder/'inputs.json'))
    remote(config,'launch',job)
    cancelled=False
    def cancel(_signum,_frame):
        nonlocal cancelled
        cancelled=True
    signal.signal(signal.SIGTERM,cancel);signal.signal(signal.SIGINT,cancel)
    cancel_sent=False
    while True:
        if cancelled and not cancel_sent:
            remote(config,'cancel',job);cancel_sent=True
        state=remote(config,'poll',job)
        if state.get('frames'): print(json.dumps({'frame':state.get('frame',0),'frames':state['frames'],'stage':'Refining facial identity on GPU'}),flush=True)
        if state['state']=='completed': break
        if state['state']=='interrupted':
            if cancel_sent: print('RECAST_FACE_CANCELLED',flush=True)
            raise ValueError(state.get('error','GPU refinement interrupted. Saved frames remain on the same rental.'))
        time.sleep(1)
    if cancelled:
        print('RECAST_FACE_CANCELLED',flush=True);raise ValueError('GPU face refinement cancelled; completed remote output is retained.')
    for name in ['identity-video.json','final.mp4']:
        sync(config,str(folder/'result'/name),str(output/name),download=True)
    result=json.loads((output/'identity-video.json').read_text())
    if not result.get('complete') or result.get('outputSHA256')!=digest(output/'final.mp4'):
        raise ValueError('GPU result checksum failed. Resume retrieves the existing result; no video regeneration is needed.')
    result['instanceId']=a.instance_id
    # Transport provenance is separate from the immutable remote receipt.
    (output/'gpu-transport.json').write_text(json.dumps({'instanceId':a.instance_id,'jobId':job,'receiptSHA256':digest(output/'identity-video.json')}))
    print('RECAST_FACE '+json.dumps({key:value for key,value in result.items() if key!='records'}),flush=True)


if __name__=='__main__':
    try: main()
    except (OSError,ValueError,subprocess.SubprocessError) as error: raise SystemExit(str(error))
