#!/usr/bin/env python3
"""Isolated Clarity worker. Reads never install, download or start compute."""
import argparse
import fcntl
from fractions import Fraction
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import signal
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / 'config/upscale-runtime.lock.json'
MODELS = ROOT / 'config/upscale-models.lock.json'
SOURCE = ROOT / '.local/flashvsr-plus'
PYTHON = ROOT / '.local/venv/bin/python'


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(4*1024**2), b''): h.update(block)
    return h.hexdigest()


def atomic(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp.json'); temp.write_text(json.dumps(value)); temp.replace(path)


def profile_hash():
    return hashlib.sha256(PROFILE.read_bytes()+MODELS.read_bytes()+Path(__file__).read_bytes()+(ROOT/'scripts/clarity_video.py').read_bytes()).hexdigest()


def state(path):
    try: return json.loads(Path(path).read_text())
    except (OSError, ValueError): return {}


def info(path):
    data = json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_streams','-show_frames',
        '-show_entries','stream=width,height,avg_frame_rate,sample_aspect_ratio,color_transfer:stream_side_data=rotation:frame=best_effort_timestamp_time', '-of','json',str(path)]))
    stream = data['streams'][0]; frames = data.get('frames', [])
    if stream.get('color_transfer') in ('smpte2084', 'arib-std-b67'):
        raise ValueError('Convert HDR footage to SDR before using Clarity.')
    fps = Fraction(stream['avg_frame_rate']); count = len(frames)
    if not 1 <= fps <= 60 or not count or count / fps > 300:
        raise ValueError('Clarity supports constant-rate videos up to five minutes and 60 fps.')
    stamps = [float(f['best_effort_timestamp_time']) for f in frames]
    if any(not math.isfinite(t) or abs((t-stamps[0])-i/float(fps)) > .002 for i,t in enumerate(stamps)):
        raise ValueError('Use a constant-frame-rate video. Clarity will not drop or invent frames.')
    if stream.get('sample_aspect_ratio') not in (None, '0:1', '1:1'):
        raise ValueError('Convert non-square-pixel video to square pixels first.')
    rotation = next((float(s['rotation']) for s in stream.get('side_data_list', []) if 'rotation' in s), 0)
    if rotation % 90: raise ValueError('Normalize custom video rotation first.')
    w,h = int(stream['width']),int(stream['height'])
    if abs(rotation) % 180 == 90: w,h = h,w
    return {'width':w,'height':h,'frames':count,'fps':str(fps)}


def validate_source(path):
    timing=info(path)
    streams=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(path)]))['streams']
    audio=[s for s in streams if s.get('codec_type')=='audio']
    if len(audio)>1 or any(s.get('codec_name')not in ('aac','mp3','alac','ac3','eac3')for s in audio):
        raise ValueError('Use a video with one MP4-compatible audio track (for example AAC), or no audio. Clarity copies the original audio without re-encoding.')
    return timing


def running(folder):
    pid = state(folder/'pid.json').get('pid')
    try:
        cmd = Path(f'/proc/{int(pid)}/cmdline').read_bytes()
        return b'upscale_worker.py' in cmd and folder.name.encode() in cmd
    except (OSError, TypeError, ValueError): return False


def setup_running():
    try:
        pid = int(state(ROOT/'state/setup-pid.json').get('pid', 0))
        if pid <= 0: return False
        # The detached setup owns its process group; pip children remain busy
        # even if the parent dies before recording its terminal receipt.
        os.killpg(pid, 0)
        rows=subprocess.check_output(['ps','-eo','pgid=,stat='],text=True).splitlines()
        return any(int(row.split()[0])==pid and not row.split()[1].startswith('Z')for row in rows if row.strip())
    except (ProcessLookupError, ValueError): return False
    except (OSError, subprocess.SubprocessError): return True


def inspect(verify=False):
    missing=[]; manifest=json.loads(MODELS.read_text()); config=json.loads(PROFILE.read_text())
    for item in manifest['files']:
        file=ROOT.parent/'models'/item['destination']
        if file.is_symlink() or not file.is_file() or file.stat().st_size!=item['size'] or verify and sha(file)!=item['sha256']:
            missing.append(item['destination'])
    marker=state(ROOT/'state/ready.json')
    ready=PYTHON.is_file() and marker.get('profileSHA256')==profile_hash()
    try: ready=ready and subprocess.check_output(['git','-C',str(SOURCE),'rev-parse','HEAD'],stderr=subprocess.DEVNULL,text=True).strip()==config['revision']
    except (OSError,subprocess.SubprocessError): ready=False
    if not ready: missing.append('Isolated Clarity runtime')
    active_jobs=[p.name for p in (ROOT/'jobs').glob('*')if p.is_dir()and running(p)]
    return {'ready':not missing,'preparing':setup_running(),'processing':bool(active_jobs),'activeJobs':active_jobs,
            'error':state(ROOT/'state/setup.json').get('error'),'missing':missing,'profileSHA256':profile_hash(),
            'modelBytes':manifest['total_bytes'],'runtimeReserveBytes':config['runtime_reserve_bytes']}


def idle():
    port=json.loads((ROOT/'config/server.json').read_text())['port']
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/queue',timeout=10)as response:q=json.load(response)
    if q.get('queue_running') or q.get('queue_pending'): raise ValueError('Finish ComfyUI work before using Clarity.')
    return port


def prepare():
    import shutil
    config=json.loads(PROFILE.read_text()); (ROOT/'state').mkdir(exist_ok=True)
    with (ROOT/'state/setup.lock').open('a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); idle()
        if any(running(p)for p in (ROOT/'jobs').glob('*')if p.is_dir()): raise ValueError('Finish the existing Clarity upscale before preparing tools.')
        if platform.machine()!='x86_64': raise ValueError('This Clarity runtime currently requires an x86_64 CUDA host.')
        if not (3,10) <= sys.version_info[:2] <= (3,12): raise ValueError('Clarity setup needs Python 3.10–3.12 on the host.')
        if shutil.disk_usage(ROOT).free < config['runtime_reserve_bytes']+config['working_reserve_bytes']:
            raise ValueError('Free at least 15 GiB for the isolated runtime and working reserve before preparation.')
        atomic(ROOT/'state/setup-pid.json',{'pid':os.getpid()})
        (ROOT/'state/ready.json').unlink(missing_ok=True)
        SOURCE.parent.mkdir(parents=True,exist_ok=True)
        if not SOURCE.exists():
            subprocess.run(['git','clone','--filter=blob:none','--no-checkout',config['repository'],str(SOURCE)],check=True)
            subprocess.run(['git','-C',str(SOURCE),'checkout','--detach',config['revision']],env={**os.environ,'GIT_LFS_SKIP_SMUDGE':'1'},check=True)
        if subprocess.check_output(['git','-C',str(SOURCE),'rev-parse','HEAD'],text=True).strip()!=config['revision']:
            raise ValueError('The saved FlashVSR source revision differs; existing files were preserved.')
        if not PYTHON.exists(): subprocess.run([sys.executable,'-m','venv',str(PYTHON.parent.parent)],check=True)
        env={**os.environ,'PIP_NO_CACHE_DIR':'1'}
        subprocess.run([str(PYTHON),'-m','pip','install',config['torch'],'--index-url',config['torch_index']],env=env,check=True)
        subprocess.run([str(PYTHON),'-m','pip','install',*config['packages']],env=env,check=True)
        subprocess.run([str(PYTHON),'-c','import torch;assert torch.__version__.startswith("2.7.1") and torch.cuda.is_available();import inference'],cwd=SOURCE,check=True)
        # The prompt tensor is part of the pinned source, not a new encoder.
        prompt=SOURCE/'prompt_tensor/posi_prompt.pth'
        if prompt.read_bytes().startswith(b'version https://git-lfs.github.com/spec/'):
            pointer=prompt.read_text().splitlines(); expected=next(x.split(':',1)[1]for x in pointer if x.startswith('oid sha256:'))
            temp=prompt.with_suffix('.part')
            with urllib.request.urlopen(f'https://media.githubusercontent.com/media/OpenImagingLab/FlashVSR_Plus/{config["revision"]}/prompt_tensor/posi_prompt.pth',timeout=60)as r,temp.open('wb')as f: shutil.copyfileobj(r,f)
            if sha(temp)!=expected: raise ValueError('The pinned context tensor failed checksum verification.')
            temp.replace(prompt)
        atomic(ROOT/'state/ready.json',{'profileSHA256':profile_hash(),'promptSHA256':sha(prompt)})


def progress(folder,value,stage,frames=None):
    old=state(folder/'worker.json')
    atomic(folder/'worker.json',{'state':'running','progress':max(old.get('progress',0),min(99,value)),'stage':stage,'frames':old.get('frames',0)if frames is None else frames})
    if (folder/'CANCEL').exists(): raise ValueError('Clarity cancelled. Original video and partial files are kept.')
    idle()


def process(folder):
    import shutil
    request=state(folder/'request.json'); config=json.loads(PROFILE.read_text()); source=folder/'source.video'
    if request.get('profileSHA256')!=profile_hash() or sha(source)!=request['sourceSHA256']:
        raise ValueError('Saved upscale inputs or recipe changed; no inference was repeated.')
    signature={k:request[k]for k in request}
    result=folder/'result';result.mkdir(exist_ok=True); receipt=state(result/'receipt.json')
    if receipt.get('complete'):
        if receipt.get('request')!=signature or sha(result/'final.mp4')!=receipt['outputSHA256']:raise ValueError('Saved upscale result failed verification.')
        return receipt
    if (folder/'attempt.json').exists(): raise ValueError('An earlier upscale attempt exists. Recover it or explicitly create a new retry; partial work was preserved.')
    if not inspect(True)['ready']: raise ValueError('Download the Clarity weights and prepare its runtime explicitly first.')
    if validate_source(source)!=request['input']: raise ValueError('Source timing or geometry changed.')
    g=request['geometry'];expected=request['input']
    working_bytes=config['working_reserve_bytes']+int(g['workWidth']*g['workHeight']*expected['frames']*6*1.25)
    if shutil.disk_usage(ROOT).free < working_bytes: raise ValueError(f'Free at least {math.ceil(working_bytes/1024**3)} GiB for this full video and working reserve.')
    port=idle()
    def memory():
        raw=subprocess.check_output(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits'],text=True)
        values=[float(v.strip())*1024**2 for v in raw.splitlines()]
        if len(values)!=1: raise ValueError('Clarity uses one visible GPU.')
        return values[0]
    if memory()<config['free_gpu_bytes']:
        req=urllib.request.Request(f'http://127.0.0.1:{port}/free',data=json.dumps({'unload_models':True,'free_memory':True}).encode(),headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=20):pass
        for _ in range(20):
            if memory()>=config['free_gpu_bytes']:break
            time.sleep(.5)
        if memory()<config['free_gpu_bytes']:raise ValueError('Clarity needs 20 GiB free VRAM. Finish other GPU work first.')
    progress(folder,4,'Preparing full-frame video'); g=request['geometry']; expected=request['input']
    # Supply the exact working aspect ratio so upstream centre-cropping is a no-op.
    prepared=folder/'prepared.mkv'
    vf=f'setpts=PTS-STARTPTS,scale={g["outputWidth"]}:{g["outputHeight"]}:flags=lanczos,pad={g["workWidth"]}:{g["workHeight"]}:{g["padX"]}:{g["padY"]}:color=black,setsar=1'
    subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-i',str(source),'-an','-vf',vf,'-c:v','ffv1','-pix_fmt','yuv420p','-level','3','-threads','2',str(prepared)],check=True)
    test=info(prepared)
    if test!={**expected,'width':g['workWidth'],'height':g['workHeight']}:raise ValueError('Preparation changed frame count or timing.')
    progress(folder,12,'Loading FlashVSR+ Turbo');atomic(folder/'attempt.json',{'request':signature,'startedAt':time.time()})
    started=time.monotonic();sys.path.insert(0,str(SOURCE))
    from inference import InferenceRequest,build_inference_pipeline
    from inference.presets import stream_config_for_mode
    from inference.loading import ModelPaths
    weights=ROOT.parent/'models/upscale/flashvsr-plus'
    settings=request['settings']
    cfg=stream_config_for_mode('turbo',device='cuda:0',hardware_profile='generic',attn_kernel='sdpa',decode_every=config['decoder_latent_chunk'],tiny_decoder_mode='serial',
        temporal_compression=4 if settings['motion']=='fast'else 2,color_correction=settings['matchColors'])
    paths=ModelPaths(dit=str(weights/'turbo/dit.safetensors'),lq_projection=str(weights/'turbo/lq_proj_in.safetensors'),tiny_decoder=str(weights/'TCDecoder.ckpt'),context=str(SOURCE/'prompt_tensor/posi_prompt.pth'))
    pipeline=build_inference_pipeline(cfg,paths)
    progress(folder,18,'Upscaling video')
    from clarity_video import ClarityVideoWriter
    import inference.pipeline as pipeline_module
    def frame_progress(count):
        if count%8==0 or count==expected['frames']:progress(folder,18+67*min(1,count/expected['frames']),f'Upscaling · {count}/{expected["frames"]} frames',count)
    # Keep upstream model/attention math, replacing its H.264 intermediate
    # with verified lossless RGB; final MP4 is encoded only once.
    pipeline_module.IncrementalVideoWriter=lambda file,fps,**kwargs:ClarityVideoWriter(file,expected['fps'],g,frame_progress)
    def update(message):
        # Upstream progress is stage text; never turn elapsed time into fake %.
        progress(folder,state(folder/'worker.json').get('progress',18),message[-200:])
    out=pipeline.infer(InferenceRequest(input_path=str(prepared),output_path=str(result/'working.mkv'),height=g['workHeight'],width=g['workWidth'],fps=float(Fraction(expected['fps']))),progress=update,video_preset='medium')
    if out.frames!=expected['frames']:raise ValueError('Upscaling changed frame count; output was kept for inspection.')
    progress(folder,90,'Restoring original framing and audio')
    final=result/'final.part.mp4'
    subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-i',str(result/'working.mkv'),'-i',str(source),'-map','0:v:0','-map','1:a:0?',
        '-vf','setsar=1','-r',expected['fps'],'-fps_mode','cfr','-frames:v',str(expected['frames']),'-c:v','libx264','-crf','16','-preset','medium','-threads','2','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(final)],check=True)
    if info(final)!={**expected,'width':g['outputWidth'],'height':g['outputHeight']}:raise ValueError('Final upscale timing or geometry failed verification.')
    def audio_hash(file):
        p=subprocess.run(['ffmpeg','-v','error','-i',str(file),'-map','0:a:0?','-c:a','copy','-f','data','-'],capture_output=True)
        if p.returncode and b'does not contain any stream'not in p.stderr:raise ValueError('Could not verify copied audio.')
        return hashlib.sha256(p.stdout).hexdigest()
    if audio_hash(source)!=audio_hash(final):raise ValueError('Original audio failed verification.')
    if sha(source)!=request['sourceSHA256']:raise ValueError('Source changed during upscaling.')
    final.replace(result/'final.mp4')
    receipt={'complete':True,'request':signature,'outputSHA256':sha(result/'final.mp4'),'frames':expected['frames'],'fps':expected['fps'],
        'width':g['outputWidth'],'height':g['outputHeight'],'workerSeconds':time.monotonic()-started,'attention':'sdpa','audioPreserved':True,'framingPreserved':True}
    atomic(result/'receipt.json',receipt)
    prepared.unlink(missing_ok=True)
    (result/'working.mkv').unlink(missing_ok=True)
    return receipt


def main():
    p=argparse.ArgumentParser();p.add_argument('action',choices=['status','prepare','setup-worker','launch','worker','poll','cancel']);p.add_argument('--job');a=p.parse_args()
    if a.action=='status':value=inspect()
    elif a.action=='prepare':
        (ROOT/'state').mkdir(parents=True,exist_ok=True)
        if not setup_running():
            atomic(ROOT/'state/setup.json',{'complete':False})
            with (ROOT/'state/setup.log').open('ab')as log:
                child=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'setup-worker'],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
            atomic(ROOT/'state/setup-pid.json',{'pid':child.pid})
        value=inspect()
    elif a.action=='setup-worker':
        try:
            prepare();atomic(ROOT/'state/setup.json',{'complete':True})
        except Exception as error:
            atomic(ROOT/'state/setup.json',{'error':str(error)});raise
        return
    else:
        folder=ROOT/'jobs'/str(uuid.UUID(a.job))
        if not folder.is_dir():
            if a.action in ['poll','cancel']:value={'state':'absent','running':False}
            else:raise ValueError('Saved Clarity job is missing.')
        elif a.action=='poll':value={**state(folder/'worker.json'),'running':running(folder),'complete':state(folder/'result/receipt.json').get('complete',False)}
        elif a.action=='cancel':
            (folder/'CANCEL').touch();value={'running':running(folder)}
        elif a.action=='launch':
            if not running(folder):
                if (folder/'CANCEL').exists():raise ValueError('This upscale was cancelled. Create an explicit retry instead.')
                with (folder/'worker.log').open('ab')as log:
                    child=subprocess.Popen([str(PYTHON),str(Path(__file__).resolve()),'worker','--job',folder.name],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
                atomic(folder/'pid.json',{'pid':child.pid})
            value={'running':True}
        else:
            try:
                with (ROOT/'state/gpu.lock').open('a')as lock:
                    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    process(folder);atomic(folder/'worker.json',{'state':'completed','progress':100,'stage':'Ready'})
            except Exception as e:
                atomic(folder/'worker.json',{'state':'interrupted','error':str(e),'progress':state(folder/'worker.json').get('progress',0)})
                raise
            return
    print('RECAST_UPSCALE '+json.dumps(value),flush=True)


if __name__=='__main__':main()
