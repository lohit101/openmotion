#!/usr/bin/env python3
"""Private managed-host face worker. No provider API, rentals or implicit setup."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.parse
import uuid

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
from local_identity import digest, locations
from video_identity import status as model_status


def atomic(file, data):
    temporary = file.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(data)+'\n'); os.replace(temporary, file)


def idle():
    port = json.loads((ROOT/'config/server.json').read_text())['port']
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/queue', timeout=15) as response:
        queue = json.load(response)
    if queue.get('queue_running') or queue.get('queue_pending'):
        raise ValueError('Finish the ComfyUI queue before GPU face refinement. No render was interrupted.')
    return port


def inspect():
    ready = model_status()
    marker = ROOT/'state/gpu-face-ready.json'
    current = digest(ROOT/'config/gpu-video-identity.lock.json')
    if not marker.is_file() or json.loads(marker.read_text()).get('profile') != current:
        ready['missing'].append('CUDA runtime setup')
    ready.update(ready=not ready['missing'], execution='remote CUDA',location='managed GPU')
    performance_profile=ROOT/'config/face-source-profile.json'
    if performance_profile.is_file() and (ROOT/'scripts/source_face_performance.py').is_file():
        ready.update(performanceProfile=digest(performance_profile))
    return ready


def setup():
    idle()
    if platform.machine() != 'x86_64':
        raise ValueError('This pinned CUDA face runtime currently supports x86_64 hosts only.')
    gpu_config = json.loads((ROOT/'config/gpu-video-identity.lock.json').read_text())
    if inspect()['ready']:
        return inspect()
    config, source, runtime = locations()
    if shutil.disk_usage(ROOT).free < gpu_config['model_bytes'] + gpu_config['reserve_bytes'] + 1024**3:
        raise ValueError('Free at least 7.7 GB for the face runtime, models and working reserve. No setup download started.')
    engine = ROOT.parent/'.venv/bin/python'
    cuda = subprocess.check_output([str(engine), '-c', 'import torch;print(torch.version.cuda)'], text=True).strip()
    if not cuda.startswith('13.'):
        raise ValueError('This CUDA face runtime requires the existing CUDA 13 engine. Its packages were not changed.')
    if not source.exists():
        subprocess.run(['git','clone','--filter=blob:none','--no-checkout',config['repository'],str(source)],check=True)
        subprocess.run(['git','-C',str(source),'checkout','--detach',config['revision']],check=True)
    if subprocess.check_output(['git','-C',str(source),'rev-parse','HEAD'],text=True).strip() != config['revision']:
        raise ValueError('Unexpected FaceFusion revision; existing source was preserved.')
    if not runtime.is_file():
        subprocess.run([str(engine),'-m','venv','--system-site-packages',str(runtime.parent.parent)],check=True)
    # A venv created by another venv does not inherit that venv's packages.
    # Share its existing PyTorch/CUDA binaries through a read-only search path;
    # install face dependencies only in the new face environment.
    engine_packages=subprocess.check_output([str(engine),'-c','import sysconfig;print(sysconfig.get_paths()["purelib"])'],text=True).strip()
    face_packages=Path(subprocess.check_output([str(runtime),'-c','import sysconfig;print(sysconfig.get_paths()["purelib"])'],text=True).strip())
    (face_packages/'recast-engine.pth').write_text(engine_packages+'\n')
    packages = [item for item in config['packages'] if not item.startswith('onnxruntime==')]
    print(json.dumps({'stage':'Installing isolated CUDA runtime'}),flush=True)
    subprocess.run([str(runtime),'-m','pip','install',*packages,*gpu_config['packages']],check=True)
    # Existing resumable/checksummed downloader, exact manifest, explicit setup.
    files = config['files'] + json.loads((ROOT/'config/local-video-identity.lock.json').read_text())['files']
    plan_files=[]
    for item in files:
        repo, _, suffix = urllib.parse.urlparse(item['url']).path.lstrip('/').partition('/resolve/')
        revision, _, filename = suffix.partition('/')
        plan_files.append({**item,'destination':item['path'],'repo':repo,'revision':revision,'filename':filename})
    manifest = {'files':plan_files}
    plan = ROOT/'state/face-models.json'; atomic(plan,manifest)
    subprocess.run([str(runtime),str(ROOT/'scripts/download_models.py'),'--manifest',str(plan),'--model-dir',str(source),'--reserve-gb','5'],check=True)
    # Loading a real swap session proves CUDA/cuDNN can be initialized; merely
    # finding CUDA in get_available_providers would accept broken installations.
    code = '''import torch, onnxruntime as ort, sys
ort.preload_dlls()
s=ort.InferenceSession(sys.argv[1],providers=['CUDAExecutionProvider'])
if 'CUDAExecutionProvider' not in s.get_providers(): raise RuntimeError('CUDA session fell back to CPU')
print(ort.__version__)
'''
    idle()
    version = subprocess.check_output([str(runtime),'-c',code,str(source/'.assets/models/hyperswap_1a_256.onnx')],text=True).strip()
    if not model_status(verify=True)['ready']:
        raise ValueError('Face model verification failed; partials were retained.')
    atomic(ROOT/'state/gpu-face-ready.json',{'profile':digest(ROOT/'config/gpu-video-identity.lock.json'),'onnxruntime':version})
    return inspect()


def running(folder):
    file = folder/'pid.json'
    if not file.exists(): return False
    pid = json.loads(file.read_text()).get('pid')
    try:
        command = Path(f'/proc/{int(pid)}/cmdline').read_bytes()
        return b'gpu_identity_worker.py' in command and folder.name.encode() in command
    except (OSError,ValueError,TypeError): return False


def worker(folder):
    import video_identity
    state = folder/'worker.json'
    with (ROOT/'state/face-operation.lock').open('a') as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            idle(); port=json.loads((ROOT/'config/server.json').read_text())['port']
            request=urllib.request.Request(f'http://127.0.0.1:{port}/free',data=b'{"unload_models":true,"free_memory":true}',headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(request,timeout=30): pass
            inputs=json.loads((folder/'inputs.json').read_text())
            if digest(folder/'target.mp4')!=inputs['parentSHA256'] or digest(folder/'reference.png')!=inputs['referenceSHA256']:
                raise ValueError('Remote refinement inputs changed. Original media was preserved.')
            atomic(state,{'state':'running','startedAt':time.time()})
            method=inputs.get('method','direct')
            performance_source=folder/'performance.mp4' if method=='source-performance' else None
            if performance_source and (digest(performance_source)!=inputs.get('performanceSHA256') or digest(ROOT/'config/face-source-profile.json')!=inputs.get('performanceProfile')):
                raise ValueError('Source face-performance input or profile changed. Saved frames were preserved.')
            video_identity.run(folder/'reference.png',folder/'target.mp4',folder/'result','cuda',method,performance_source)
            atomic(state,{'state':'completed','finishedAt':time.time()})
        except BaseException as error:
            atomic(state,{'state':'interrupted','error':str(error)[-1500:]})
            raise


def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['status','setup','launch','poll','cancel','worker']);p.add_argument('--job');a=p.parse_args()
    (ROOT/'state').mkdir(parents=True,exist_ok=True)
    if a.action=='status': result=inspect()
    elif a.action=='setup':
        with (ROOT/'state/face-operation.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);result=setup()
    else:
        job=str(uuid.UUID(a.job));folder=ROOT/'jobs'/job
        if not folder.is_dir(): raise ValueError('Refinement job is not prepared.')
        if a.action=='worker': worker(folder);return
        if a.action=='cancel':
            (folder/'result').mkdir(exist_ok=True);(folder/'result/CANCEL').touch();result={'cancelRequested':True,'running':running(folder)}
        elif a.action=='launch':
            with (folder/'launch.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX)
                if not running(folder):
                    if not inspect()['ready']: raise ValueError('Prepare GPU face refinement explicitly before running.')
                    idle()
                    if shutil.disk_usage(ROOT).free < json.loads((folder/'inputs.json').read_text())['workingBytes']:
                        raise ValueError('Insufficient GPU disk space for resumable face frames.')
                    (folder/'result').mkdir(exist_ok=True);(folder/'result/CANCEL').unlink(missing_ok=True)
                    (folder/'worker.json').unlink(missing_ok=True)
                    _,_,runtime=locations()
                    with (folder/'worker.log').open('ab') as log:
                        child=subprocess.Popen([str(runtime),'-u',str(__file__),'worker','--job',job],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
                    atomic(folder/'pid.json',{'pid':child.pid})
            result={'launched':True}
        else:
            state=folder/'worker.json';result=json.loads(state.read_text()) if state.is_file() else {'state':'starting'}
            receipt=folder/'result/identity-video.json'
            if receipt.is_file():
                saved=json.loads(receipt.read_text());result.update(frame=len(saved['records']),frames=saved['inputs']['frames'])
            if not running(folder) and result['state'] not in ['completed','interrupted']:
                result.update(state='interrupted',error='Remote worker stopped. Resume checks the saved frames; no new video generation is needed.')
    print('RECAST_FACE '+json.dumps(result),flush=True)


if __name__=='__main__':
    try: main()
    except (OSError,ValueError,subprocess.SubprocessError) as error: raise SystemExit(str(error))
