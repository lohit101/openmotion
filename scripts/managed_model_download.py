"""Observe detached transfers across SSH outages; never starts GPU compute."""
import hashlib
import tempfile
import json
from pathlib import Path
import signal
import subprocess
import tarfile
import time

import vast
from model_download_worker import key_for
from model_policy import assert_downloadable

ROOT=Path(__file__).resolve().parents[1]
FILES=['scripts/download_models.py','scripts/model_download_worker.py','scripts/model_setup_worker.py',
       'scripts/xet_download.py','config/model-download-runtime.lock.json',
       'scripts/model_policy.py','config/active-models.json']


def runtime_path(config):
    digest=hashlib.sha256(b''.join((ROOT/f).read_bytes()for f in FILES)).hexdigest()
    return Path(config['remote_root'])/'state/model-download-runtime'/digest


def upload(config):
    root=runtime_path(config);stream=tempfile.TemporaryFile()
    with tarfile.open(fileobj=stream,mode='w:gz')as archive:
        for file in FILES:archive.add(ROOT/file,arcname=file,recursive=False)
    stream.seek(0)
    code='''from pathlib import Path
import tarfile,sys,tempfile,shutil,os
r=Path(sys.argv[1]);r.mkdir(parents=True,exist_ok=True)
if r.is_symlink():raise ValueError('Linked download runtime')
s=Path(tempfile.mkdtemp(dir=r))
try:
 with tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz')as a:
  for m in a:
   p=Path(m.name)
   if p.is_absolute()or'..'in p.parts or not m.isfile()or(r/p).is_symlink():raise ValueError('Unsafe download runtime file')
   a.extract(m,s,filter='data');(r/p).parent.mkdir(parents=True,exist_ok=True)
   if (r/p).exists():
    if (r/p).read_bytes()!=(s/p).read_bytes():raise ValueError('Pinned download runtime changed')
   else:os.replace(s/p,r/p)
finally:shutil.rmtree(s)
'''
    try:vast.remote(config,['python3','-c',code,str(root)],stdin=stream,timeout=30)
    finally:stream.close()
    return root/'scripts/model_download_worker.py'


def locate(config,key):
    code='''from pathlib import Path
import json,sys
r=Path(sys.argv[1]);p=r/'state/model-downloads'/sys.argv[2]/'runtime.json'
if not p.is_file():print('ABSENT');sys.exit(0)
s=Path(json.loads(p.read_text())['script']);relative=s.relative_to(r/'state/model-download-runtime')
if len(relative.parts)!=3 or relative.parts[1:]!=('scripts','model_download_worker.py')or not s.is_file():raise ValueError('Unknown saved model transfer runtime')
print(s)
'''
    result=vast.remote(config,['python3','-c',code,config['remote_root'],key],capture_output=True,text=True,timeout=25)
    value=result.stdout.strip()
    return None if value=='ABSENT'else Path(value)


def call(config,script,action,key,manifest=None):
    args=['python3',str(script),action,'--root',config['remote_root'],'--job',key]
    if manifest is not None:args+=['--manifest',json.dumps(manifest),'--retry']
    result=vast.remote(config,args,capture_output=True,text=True,timeout=25)
    lines=[line[19:]for line in result.stdout.splitlines()if line.startswith('RECAST_MODEL_STATE ')]
    if not lines:raise RuntimeError('The GPU did not return a model-transfer status.')
    value=json.loads(lines[-1])
    if value.get('manifestSHA256')!=key:raise RuntimeError('Model-transfer status belongs to another request.')
    return value


def transfer(config,manifest,recover=False,cancel_requested=False,*,sleep=time.sleep):
    if len(manifest['files'])!=1:raise ValueError('A tracked transfer must contain exactly one file.')
    if not recover and not cancel_requested:assert_downloadable([item['destination'] for item in manifest['files']])
    item=manifest['files'][0];key=key_for(manifest);cancelled=cancel_requested;script=None;last={'downloaded':0};failures=0;started=recover
    def cancel(_sig,_frame):
        nonlocal cancelled
        cancelled=True
    signal.signal(signal.SIGTERM,cancel);signal.signal(signal.SIGINT,cancel)
    def emit(phase,**extra):
        print('RECAST_MODEL_PROGRESS '+json.dumps({'destination':item['destination'],'total':item['size'],
            'downloaded':max(0,min(item['size'],last.get('downloaded',0))),'phase':phase,**extra}),flush=True)
    while True:
        try:
            if script is None:
                script=locate(config,key)if recover or cancelled else upload(config)
                if script is None:
                    print('RECAST_MODEL_STOPPED',flush=True)
                    if cancelled:return False
                    raise FileNotFoundError('The saved transfer is absent. Click Retry downloads to resume its partial file.')
            if cancelled:value=call(config,script,'cancel',key)
            elif not started:
                # If this SSH response is lost, subsequent iterations only poll
                # the idempotent saved job, rather than starting a second copy.
                started=True;value=call(config,script,'start',key,manifest)
            else:value=call(config,script,'status',key)
            failures=0;last=value
            emit(value['phase'],bytesPerSecond=value.get('bytesPerSecond'),running=value['running'],confirmedStopped=value.get('confirmedStopped',False))
            if value.get('confirmedStopped'):
                print('RECAST_MODEL_STOPPED',flush=True)
                if cancelled:return False
                if value['phase']=='ready':return True
                raise FileNotFoundError(value.get('error')or'The transfer stopped. Retry downloads to resume saved partial files.')
        except FileNotFoundError:raise
        except (OSError,subprocess.SubprocessError,RuntimeError,ValueError)as error:
            failures+=1;emit('reconnecting',message='Reconnecting to the saved transfer. Partial files are retained.',running=True,confirmedStopped=False)
            if cancelled and failures>=3:raise RuntimeError('Cancellation is unconfirmed. Reconnect to check the original GPU; partial files are retained.')from error
            sleep(min(15,2**min(failures,4)))
            continue
        sleep(2)
