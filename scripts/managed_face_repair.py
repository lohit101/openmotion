#!/usr/bin/env python3
"""Explicit selective repair on an existing rental; never setup/rent/resume."""
import argparse
import json
import os
from pathlib import Path
import signal
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

import vast
from managed_models import check_connection
from managed_video_identity import sync
from managed_facial_consistency import remote_root, status, prepare_memory, write_request
from facial_runtime import ROOT, digest
from face_repair import FILES, validate_request
from face_repair import canonical_hash


def call(config, action, job):
    command = ['python3',str(remote_root(config)/'scripts/face_repair_worker.py'),action,'--job',job]
    value = vast.remote(config,command,capture_output=True,text=True)
    rows = [line[len('RECAST_FACE_REPAIR '):] for line in value.stdout.splitlines() if line.startswith('RECAST_FACE_REPAIR ')]
    if not rows:
        raise ValueError('The repair worker returned no authenticated status receipt.')
    return json.loads(rows[-1])


def launch(config, job):
    try:
        return call(config,'launch',job)
    except subprocess.CalledProcessError:
        # A lost launch response is not proof of failure.  Clear the pending
        # remote handle only after polling this exact owned worker's PID.
        try:
            if call(config,'poll',job).get('running') is False:
                print('RECAST_FACE_REPAIR_STOPPED',flush=True)
        except (ValueError,OSError,subprocess.SubprocessError):
            pass
        raise


def probe(config, job):
    """A missing owned folder is conclusive only with an exact PID audit."""
    code = '''import os,pathlib,json,sys
r=pathlib.Path(sys.argv[1]);job=sys.argv[2];found=False
for p in pathlib.Path('/proc').iterdir():
 if not p.name.isdigit()or int(p.name)==os.getpid():continue
 try:args=(p/'cmdline').read_bytes().split(b'\\0')
 except FileNotFoundError:continue
 if len(args)>=5 and pathlib.Path(os.fsdecode(args[1])).name=='face_repair_worker.py' and args[2]==b'worker':
  try:index=args.index(b'--job');found|=args[index+1].decode()==job
  except(ValueError,IndexError,UnicodeDecodeError):raise ValueError('Unreadable owned repair process')
print(json.dumps({'script':(r/'scripts/face_repair_worker.py').is_file(),'folder':(r/'jobs'/job).is_dir(),'process':found}))
'''
    value = vast.remote(config,['python3','-c',code,str(remote_root(config)),job],capture_output=True,text=True)
    result = json.loads(value.stdout)
    if any(type(result.get(k)) is not bool for k in ('script','folder','process')):
        raise ValueError('Could not independently inspect the owned repair handle.')
    return result


def upload(config):
    """Only the new small worker files; installed historical runtime stays put."""
    code = '''import pathlib,tarfile,sys,tempfile,os,shutil
r=pathlib.Path(sys.argv[1]);stage=pathlib.Path(tempfile.mkdtemp(prefix='.repair-upload-',dir=r))
try:
 with tarfile.open(fileobj=sys.stdin.buffer,mode='r|gz')as a:
  names=[]
  for m in a:
   p=pathlib.Path(m.name)
   if p.is_absolute()or'..'in p.parts or not m.isfile():raise ValueError('Unsafe repair archive')
   if (r/p).is_symlink()or any((r/x).is_symlink()for x in p.parents):raise ValueError('Linked repair runtime path')
   a.extract(m,stage,filter='data');names.append(p)
 for p in names:os.replace(stage/p,r/p)
finally:shutil.rmtree(stage)
'''
    with tempfile.TemporaryFile() as stream:
        with tarfile.open(fileobj=stream,mode='w:gz') as archive:
            for name in FILES:
                archive.add(ROOT/name,arcname=name,recursive=False)
        stream.seek(0)
        vast.remote(config,['python3','-c',code,str(remote_root(config))],stdin=stream)


def verify_download(output, request):
    file = output/'receipt.json'
    if not file.is_file():
        return None
    receipt = json.loads(file.read_text())
    if receipt.get('request') != request:
        raise ValueError('The downloaded repair belongs to a different frozen request.')
    if not receipt.get('complete'):
        return None
    for row in receipt.get('candidates',[]):
        if row.get('id') not in ('boundary','identity80'):
            raise ValueError('Unexpected repair candidate identifier.')
        for kind,ext in (('preview','mp4'),('master','mkv')):
            if row.get(kind) != f"candidate-{row['id']}.{ext}":
                raise ValueError('Unsafe candidate output name.')
            local = output/row[kind]
            if not local.is_file():
                return None
            if digest(local) != row[kind+'SHA256']:
                raise ValueError('Downloaded repair checksum failed; remote output was retained.')
    if not 1 <= len(receipt.get('candidates',[])) <= 2:
        raise ValueError('The repair returned an invalid number of candidates.')
    return receipt


def stopped_marker(output, request):
    file = output/'remote-stopped.json'
    if not file.is_file():
        return False
    value = json.loads(file.read_text())
    return value == {'jobId':request['jobId'],'instanceId':request['instanceId'],
                     'requestSHA256':canonical_hash(request),'stopped':True}


def try_offline(output, request):
    """No SSH/status/compute actions after verified required frames arrive."""
    if not stopped_marker(output,request):
        return None
    receipt = verify_download(output,request)
    if receipt:
        return receipt
    file = output/'receipt.json'
    if not file.is_file():
        return None
    receipt = json.loads(file.read_text())
    if receipt.get('request') != request:
        raise ValueError('The offline checkpoint belongs to another repair request.')
    if len(receipt.get('records',[])) != request['frames']:
        return None
    ready_file = output/'checkpoint-ready.json'
    if not ready_file.is_file():
        return None
    ready = json.loads(ready_file.read_text())
    if ready.get('version') != 'face-repair-checkpoints-v1' or ready.get('receiptSHA256') != digest(file) or ready.get('complete') is not True:
        raise ValueError('The local repair checkpoint manifest changed.')
    if ready.get('requestSHA256') != canonical_hash(request) or ready.get('jobId') != request['jobId'] or ready.get('instanceId') != request['instanceId']:
        raise ValueError('The local repair checkpoint belongs to another worker.')
    from face_repair_worker import verify_records,assemble_offline
    ids = verify_records(receipt,request)
    for row in receipt['records']:
        for candidate in ids:
            if row['outputs'][candidate]['changedPixels'] and not (output/'frames'/candidate/f"frame-{row['frame']:06d}.png").is_file():
                return None
    receipt = assemble_offline(request,receipt,output/'frames',output)
    (output/'transport.json').write_text(json.dumps({'jobId':request['jobId'],'instanceId':request['instanceId'],
        'receiptSHA256':digest(output/'receipt.json'),'assembly':'local-CPU'})+'\n')
    return receipt


def download_checkpoints(config, folder, output, request):
    sync(config,str(folder/'result/receipt.json'),str(output/'receipt.json'),download=True)
    receipt = json.loads((output/'receipt.json').read_text())
    if receipt.get('request') != request:
        raise ValueError('The downloaded repair checkpoint request changed.')
    from face_repair_worker import verify_records
    ids = verify_records(receipt,request)
    if len(receipt['records']) != request['frames']:
        return receipt
    for candidate in ids:
        selected = [row for row in receipt['records'] if row['outputs'][candidate]['changedPixels']]
        destination = output/'frames'/candidate
        destination.mkdir(parents=True,exist_ok=True)
        if selected:
            # One resumable authenticated rsync per candidate, not one SSH
            # round trip per repaired video frame.  The list is receipt-bound.
            with tempfile.NamedTemporaryFile(mode='w',suffix='.txt') as names:
                names.write(''.join(f"frame-{row['frame']:06d}.png\n" for row in selected))
                names.flush()
                command = ['rsync','-a','--partial','--checksum','--files-from',names.name,
                           '-e',shlex.join(vast.ssh_arguments(config)),
                           vast.destination(config)+':'+str(folder/'result'/candidate)+'/',str(destination)+'/']
                subprocess.run(command,check=True)
        for row in selected:
            local = destination/f"frame-{row['frame']:06d}.png"
            if digest(local) != row['outputs'][candidate]['sha256']:
                raise ValueError('A downloaded selected-frame checkpoint changed.')
    files = [{'candidate':candidate,'frame':row['frame'],
              'sha256':row['outputs'][candidate]['sha256'],'decodedSHA256':row['outputs'][candidate]['decodedSHA256']}
             for row in receipt['records'] for candidate in ids if row['outputs'][candidate]['changedPixels']]
    marker = {'version':'face-repair-checkpoints-v1','jobId':request['jobId'],'instanceId':request['instanceId'],
              'requestSHA256':canonical_hash(request),'receiptSHA256':digest(output/'receipt.json'),
              'frames':request['frames'],'complete':True,'files':files}
    (output/'checkpoint-ready.json').write_text(json.dumps(marker)+'\n')
    print('RECAST_FACE_REPAIR_LOCAL_READY',flush=True)
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--action',choices=['run','cancel'],required=True)
    parser.add_argument('--instance-id',type=int,required=True)
    parser.add_argument('--job',required=True)
    parser.add_argument('--request')
    parser.add_argument('--output')
    args = parser.parse_args()
    job = str(uuid.UUID(args.job))
    request = None
    if args.action == 'run':
        if not args.request or not args.output:
            raise ValueError('The frozen repair request and separate output folder are required.')
        request = validate_request(json.loads(Path(args.request).read_text()))
        if request['jobId'] != job or request['instanceId'] != args.instance_id:
            raise ValueError('Repair request and intended GPU instance differ.')
        output = Path(args.output).resolve()
        if any(output == Path(value).resolve() or output in Path(value).resolve().parents for value in request['inputs'].values() if value):
            raise ValueError('Repair outputs must be separate from every immutable input.')
        output.mkdir(parents=True,exist_ok=True)
        # Fully downloaded results finish offline; no provider/SSH is needed.
        saved = try_offline(output,request)
        if saved:
            print('RECAST_FACE_REPAIR_STOPPED',flush=True)
            print('RECAST_FACE_REPAIR '+json.dumps({'complete':True,'offline':True}),flush=True)
            return
    config = vast.load()
    check_connection(config,args.instance_id)
    os.environ['RECAST_SSH_BATCH'] = '1'
    if args.action == 'cancel':
        before = probe(config,job)
        if not before['folder'] and not before['process']:
            print('RECAST_FACE_REPAIR_STOPPED\nRECAST_FACE_REPAIR_CANCELLED',flush=True)
            return
        if not before['script']:
            raise ValueError('The existing repair handle cannot be inspected. No cancellation was assumed.')
        for _ in range(45):
            state = call(config,'cancel',job)
            if state.get('running') is False:
                print('RECAST_FACE_REPAIR_STOPPED\nRECAST_FACE_REPAIR_CANCELLED',flush=True)
                return
            time.sleep(1)
        raise ValueError('Repair cancellation is unconfirmed. Reconnect the same instance to check it.')
    cancelled = False
    def cancel(_signal,_frame):
        nonlocal cancelled
        cancelled = True
    signal.signal(signal.SIGTERM,cancel)
    signal.signal(signal.SIGINT,cancel)
    mapping = {'finished':('finished.mp4','finishedSHA256'),'raw':('raw.mp4','rawSHA256'),
               'source':('source.mp4','sourceSHA256'),'reference':('reference.png','referenceSHA256'),
               'receipt':('parent-receipt.json','parentReceiptSHA256'),
               'calibration':('parent-calibration.json','parentCalibrationSHA256')}
    for role,(_,key) in mapping.items():
        file = Path(request['inputs'][role])
        if not file.is_file() or file.is_symlink() or digest(file) != request['binding'][key]:
            print('RECAST_FACE_REPAIR_NOT_STARTED',flush=True)
            raise ValueError('A frozen repair input changed before launch: '+role)
    for version in {request['parent']['version'],'source-face-v11'}:
        if not status(config,version)['ready']:
            print('RECAST_FACE_REPAIR_NOT_STARTED',flush=True)
            raise ValueError('Prepare the selected facial and tracking tools first. Repair did not download models.')
    # No existing active worker can belong to this new code without its script;
    # an unavailable SSH response remains unknown, never a confirmed stop.
    owned = probe(config,job)
    if owned['process'] and (not owned['script'] or not owned['folder']):
        raise ValueError('An existing repair process has an unreadable owned folder; no new work was submitted.')
    before = call(config,'poll',job) if owned['script'] and owned['folder'] else {'running':False,'state':'unprepared'}
    if not before.get('running'):
        upload(config)
    folder = remote_root(config)/'jobs'/job
    vast.remote(config,['mkdir','-p',str(folder)])
    write_request(config,folder,'request.json',request)
    if not before.get('running'):
        for role,(name,_) in mapping.items():
            sync(config,str(Path(request['inputs'][role]).resolve()),str(folder/name))
        if cancelled:
            print('RECAST_FACE_REPAIR_STOPPED\nRECAST_FACE_REPAIR_CANCELLED',flush=True)
            raise ValueError('Repair cancelled before inference.')
        if before.get('state') != 'completed':
            prepare_memory(config,job,'run')
            if cancelled:
                print('RECAST_FACE_REPAIR_STOPPED\nRECAST_FACE_REPAIR_CANCELLED',flush=True)
                raise ValueError('Repair cancelled before inference.')
            launch(config,job)
    sent = False
    interrupted_error = None
    while True:
        if cancelled and not sent:
            call(config,'cancel',job)
            sent = True
        value = call(config,'poll',job)
        if value.get('frames'):
            print('RECAST_FACE_REPAIR_PROGRESS '+json.dumps({k:value[k] for k in ('frame','frames','stage')}),flush=True)
        if value.get('running') is False and value.get('state') in ('completed','interrupted'):
            print('RECAST_FACE_REPAIR_STOPPED',flush=True)
            (output/'remote-stopped.json').write_text(json.dumps({'jobId':job,'instanceId':args.instance_id,
                'requestSHA256':canonical_hash(request),'stopped':True})+'\n')
            if cancelled:
                print('RECAST_FACE_REPAIR_CANCELLED',flush=True)
                raise ValueError('Repair cancelled; its checkpoints remain on the same instance.')
            if value['state'] == 'interrupted':
                interrupted_error = value.get('error','Face repair was interrupted.')
            break
        time.sleep(1)
    receipt = download_checkpoints(config,folder,output,request)
    if interrupted_error:
        if try_offline(output,request):
            print('RECAST_FACE_REPAIR '+json.dumps({'complete':True,'offline':True}),flush=True)
            return
        raise ValueError(interrupted_error)
    if receipt.get('request') != request or not receipt.get('complete'):
        raise ValueError('The completed repair request failed verification.')
    for row in receipt['candidates']:
        if row.get('id') not in ('boundary','identity80'):
            raise ValueError('Unexpected repair candidate.')
        for name in (f"candidate-{row['id']}.mp4",f"candidate-{row['id']}.mkv"):
            sync(config,str(folder/'result'/name),str(output/name),download=True)
    verify_download(output,request)
    (output/'transport.json').write_text(json.dumps({'jobId':job,'instanceId':args.instance_id,
        'receiptSHA256':digest(output/'receipt.json')})+'\n')
    print('RECAST_FACE_REPAIR '+json.dumps({'complete':True,'candidates':len(receipt['candidates'])}),flush=True)


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        # SSH argv contains private key paths/connection identifiers.  Keep
        # these out of the user-facing error while retaining remote diagnosis.
        if error.returncode == 255:
            raise SystemExit('Connection to the saved repair was interrupted. Reconnect the same GPU and choose Check & resume; verified frames were retained.')
        detail = error.stderr.decode(errors='replace') if isinstance(error.stderr,bytes) else error.stderr
        raise SystemExit((detail or 'Face repair transfer or tools failed. Existing video and checkpoints were retained.')[-1600:])
    except (OSError,ValueError,subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
