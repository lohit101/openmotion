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

# Only runs from explicit preparation, before a readiness marker is written.
# Tiny masked attention comparison; never loads video weights or expands HD masks.
KERNEL_CHECK = r'''
import json, torch
from flashvsr_attn import stream_block_sparse_attention
from inference.presets import stream_config_for_mode
assert torch.cuda.is_available(), 'CUDA is unavailable'
cfg=stream_config_for_mode('turbo',device='cuda:0',hardware_profile='auto',attn_kernel='triton_block_sparse')
assert cfg.attn_kernel=='triton_block_sparse', 'Optimized attention was not selected'
torch.manual_seed(123)
with torch.inference_mode():
 q=torch.randn(1,2,2,128,128,device='cuda',dtype=torch.bfloat16)
 k=torch.randn(1,2,3,128,128,device='cuda',dtype=torch.bfloat16);v=torch.randn_like(k)
 mask=torch.tensor([[[[True,False,True],[False,True,True]]]],device='cuda').expand(1,2,2,3).contiguous()
 actual=stream_block_sparse_attention(q,k,v,mask)
 full=mask.repeat_interleave(128,dim=-2).repeat_interleave(128,dim=-1)
 expected=torch.nn.functional.scaled_dot_product_attention(q.flatten(2,3),k.flatten(2,3),v.flatten(2,3),attn_mask=full).reshape_as(actual)
 torch.testing.assert_close(actual,expected,rtol=.03,atol=.03)
 assert torch.isfinite(actual).all().item(), 'Attention produced non-finite values'
 print('RECAST_KERNEL '+json.dumps({'backend':cfg.attn_kernel,'passed':True,'gpu':torch.cuda.get_device_name(),'maxError':(actual-expected).abs().max().item()}))
'''


def kernel_verified(marker, config):
    check=marker.get('kernelCheck',{})
    return check.get('passed')is True and check.get('backend')==config['attention']


def base_installed():
    if not PYTHON.is_file():return False
    code="import importlib.metadata as m,json,sys;v=json.loads(sys.argv[1]);assert m.version('torch').split('+')[0]=='2.7.1';assert int(m.version('triton').split('.')[0])>=3;assert all(m.version(p.split('==')[0])==p.split('==')[1] for p in v['packages'])"
    return subprocess.run([str(PYTHON),'-c',code,PROFILE.read_text()],capture_output=True).returncode==0


def kernel_installed(config):
    if not PYTHON.is_file():return False
    expected=SOURCE/config['kernel_package']/'flashvsr_attn/__init__.py'
    code="import importlib.metadata as m,sys;from pathlib import Path;import flashvsr_attn;assert Path(flashvsr_attn.__file__).resolve()==Path(sys.argv[1]).resolve();assert m.version('setuptools')==sys.argv[2]"
    return subprocess.run([str(PYTHON),'-c',code,str(expected),config['kernel_setuptools'].split('==')[1]],capture_output=True).returncode==0


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(4*1024**2), b''): h.update(block)
    return h.hexdigest()


def atomic(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix('.tmp.json'); temp.write_text(json.dumps(value)); temp.replace(path)


def profile_hash():
    return hashlib.sha256(PROFILE.read_bytes()+MODELS.read_bytes()+Path(__file__).read_bytes()+(ROOT/'scripts/clarity_video.py').read_bytes()+(ROOT/'scripts/clarity_execution.py').read_bytes()).hexdigest()


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
        if file.is_symlink() or not file.is_file() or file.stat().st_size!=item['size'] or verify and not verified_weight(file,item):
            missing.append(item['destination'])
    marker=state(ROOT/'state/ready.json')
    ready=PYTHON.is_file() and marker.get('profileSHA256')==profile_hash() and kernel_verified(marker,config)
    try: ready=ready and subprocess.check_output(['git','-C',str(SOURCE),'rev-parse','HEAD'],stderr=subprocess.DEVNULL,text=True).strip()==config['revision']
    except (OSError,subprocess.SubprocessError): ready=False
    if not ready: missing.append('Optimized Clarity runtime · prepare once to add Triton attention; existing weights are reused')
    active_jobs=[p.name for p in (ROOT/'jobs').glob('*')if p.is_dir()and running(p)]
    return {'ready':not missing,'preparing':setup_running(),'processing':bool(active_jobs),'activeJobs':active_jobs,
            'error':state(ROOT/'state/setup.json').get('error'),'missing':missing,'profileSHA256':profile_hash(),
            'attention':config['attention'],'kernelCheck':marker.get('kernelCheck'),
            'modelBytes':manifest['total_bytes'],'runtimeReserveBytes':config['runtime_reserve_bytes']}


def verified_weight(file,item):
    """Hash once per exact file incarnation; invalidation includes ctime/inode.

    Status remains read-only. Explicit inference verifies unknown/changed files;
    an earlier valid checksum never licenses a file modified during hashing.
    """
    def identity():
        stat=file.stat()
        return {'size':stat.st_size,'mtimeNS':stat.st_mtime_ns,'ctimeNS':stat.st_ctime_ns,
                'inode':stat.st_ino,'device':stat.st_dev,'sha256':item['sha256']}
    cache_file=ROOT/'state/verified-models.json';cache=state(cache_file);before=identity()
    if cache.get(item['destination'])==before:return True
    if sha(file)!=item['sha256'] or identity()!=before:return False
    cache[item['destination']]=before;atomic(cache_file,cache)
    return True


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
        reuse_base=base_installed()
        reserve=config['working_reserve_bytes']+(256*1024**2 if reuse_base else config['runtime_reserve_bytes'])
        if shutil.disk_usage(ROOT).free < reserve:
            raise ValueError(f'Free at least {math.ceil(reserve/1024**3)} GiB for Clarity preparation and working reserve.')
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
        if not reuse_base:
            subprocess.run([str(PYTHON),'-m','pip','install',config['torch'],'--index-url',config['torch_index']],env=env,check=True)
            subprocess.run([str(PYTHON),'-m','pip','install',*config['packages']],env=env,check=True)
        if not kernel_installed(config):
            subprocess.run([str(PYTHON),'-m','pip','install',config['kernel_setuptools']],env=env,check=True)
            subprocess.run([str(PYTHON),'-m','pip','install','--no-deps','--no-build-isolation','-e',str(SOURCE/config['kernel_package'])],env=env,check=True)
        subprocess.run([str(PYTHON),'-c','import torch;assert torch.__version__.startswith("2.7.1") and torch.cuda.is_available();import inference'],cwd=SOURCE,check=True)
        # The prompt tensor is part of the pinned source, not a new encoder.
        prompt=SOURCE/'prompt_tensor/posi_prompt.pth'
        if prompt.read_bytes().startswith(b'version https://git-lfs.github.com/spec/'):
            pointer=prompt.read_text().splitlines(); expected=next(x.split(':',1)[1]for x in pointer if x.startswith('oid sha256:'))
            temp=prompt.with_suffix('.part')
            with urllib.request.urlopen(f'https://media.githubusercontent.com/media/OpenImagingLab/FlashVSR_Plus/{config["revision"]}/prompt_tensor/posi_prompt.pth',timeout=60)as r,temp.open('wb')as f: shutil.copyfileobj(r,f)
            if sha(temp)!=expected: raise ValueError('The pinned context tensor failed checksum verification.')
            temp.replace(prompt)
        output=subprocess.check_output([str(PYTHON),'-c',KERNEL_CHECK],cwd=SOURCE,text=True)
        lines=[line[len('RECAST_KERNEL '):]for line in output.splitlines()if line.startswith('RECAST_KERNEL ')]
        check=json.loads(lines[-1])if lines else {}
        marker={'profileSHA256':profile_hash(),'promptSHA256':sha(prompt),'kernelCheck':check}
        if not kernel_verified(marker,config):raise ValueError('Optimized attention failed its CUDA self-test. Clarity remains unready.')
        atomic(ROOT/'state/ready.json',marker)


def progress(folder,value,stage,frames=None):
    old=state(folder/'worker.json')
    atomic(folder/'worker.json',{'state':'running','progress':max(old.get('progress',0),min(99,value)),'stage':stage,'frames':old.get('frames',0)if frames is None else frames})
    if (folder/'CANCEL').exists(): raise ValueError('Clarity cancelled. Original video and partial files are kept.')
    idle()


def process(folder):
    import shutil
    from clarity_execution import PhaseTimings, cpu_threads, streamed_input, DeviceColorCorrector, move_verified_bridge, processing_geometry, export_filter
    timings=PhaseTimings();overall_started=time.monotonic()
    request=state(folder/'request.json'); config=json.loads(PROFILE.read_text()); source=folder/'source.video'
    with timings.measure('sourceVerification'):
        if request.get('profileSHA256')!=profile_hash() or sha(source)!=request['sourceSHA256']:
            raise ValueError('Saved upscale inputs or recipe changed; no inference was repeated.')
    if request.get('attention')!=config['attention']:raise ValueError('This attempt requires its original attention recipe. Create a new explicit retry with the updated runtime.')
    signature={k:request[k]for k in request}
    result=folder/'result';result.mkdir(exist_ok=True); receipt=state(result/'receipt.json')
    if receipt.get('complete'):
        if receipt.get('request')!=signature or sha(result/'final.mp4')!=receipt['outputSHA256']:raise ValueError('Saved upscale result failed verification.')
        return receipt
    if (folder/'attempt.json').exists(): raise ValueError('An earlier upscale attempt exists. Recover it or explicitly create a new retry; partial work was preserved.')
    with timings.measure('preflight'):
        if not inspect(True)['ready']: raise ValueError('Download the Clarity weights and prepare its runtime explicitly first.')
        if validate_source(source)!=request['input']: raise ValueError('Source timing or geometry changed.')
    target=request['geometry'];g=processing_geometry(request);expected=request['input']
    # One verified RGB bridge and final MP4; no on-disk prepared video.
    working_bytes=config['working_reserve_bytes']+int(g['outputWidth']*g['outputHeight']*expected['frames']*4*1.25)
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
    progress(folder,12,'Loading FlashVSR+ Turbo');atomic(folder/'attempt.json',{'request':signature,'startedAt':time.time()})
    started=time.monotonic();sys.path.insert(0,str(SOURCE))
    import torch
    threads=cpu_threads();torch.set_num_threads(threads)
    from inference import InferenceRequest,build_inference_pipeline
    from inference.presets import stream_config_for_mode
    from inference.loading import ModelPaths
    weights=ROOT.parent/'models/upscale/flashvsr-plus'
    settings=request['settings']
    cfg=stream_config_for_mode('turbo',device='cuda:0',hardware_profile='auto',attn_kernel=config['attention'],decode_every=config['decoder_latent_chunk'],tiny_decoder_mode=config['tiny_decoder_mode'],
        temporal_compression=4 if settings['motion']=='fast'else 2,color_correction=settings['matchColors'])
    if cfg.attn_kernel!=config['attention']:raise ValueError('Optimized Clarity attention is unavailable. Prepare the runtime; SDPA fallback is disabled.')
    paths=ModelPaths(dit=str(weights/'turbo/dit.safetensors'),lq_projection=str(weights/'turbo/lq_proj_in.safetensors'),tiny_decoder=str(weights/'TCDecoder.ckpt'),context=str(SOURCE/'prompt_tensor/posi_prompt.pth'))
    with timings.measure('modelLoading'):
        pipeline=build_inference_pipeline(cfg,paths)
    progress(folder,18,'Upscaling video')
    from clarity_video import ClarityVideoWriter
    import inference.pipeline as pipeline_module
    def frame_progress(count):
        if count%8==0 or count==expected['frames']:progress(folder,18+67*min(1,count/expected['frames']),f'Upscaling · {count}/{expected["frames"]} frames',count)
    # Keep upstream model/attention math, replacing its H.264 intermediate
    # with verified lossless RGB; final MP4 is encoded only once.
    pipeline_module.IncrementalVideoWriter=lambda file,fps,**kwargs:ClarityVideoWriter(file,expected['fps'],g,frame_progress,threads=threads,timings=timings)
    # Stream the same chroma-aligned full frame directly into bounded native
    # temporal windows. The source was already checked for exact CFR timing.
    pipeline_module.iter_lq_video=lambda _request,**kwargs:streamed_input(source,g,expected,timings=timings,threads=threads,stats=color_stats,**kwargs)
    pipeline_module.get_lq_video_fps=lambda _request:float(Fraction(expected['fps']))
    pipeline_module.mux_source_audio=move_verified_bridge
    import inference.runners.stream as stream_module
    native_color=stream_module.WaveletColorCorrector;color_stats={}
    stream_module.WaveletColorCorrector=lambda **kwargs:DeviceColorCorrector(native_color,timings=timings,stats=color_stats,**kwargs)
    def update(message):
        # Upstream progress is stage text; never turn elapsed time into fake %.
        progress(folder,state(folder/'worker.json').get('progress',18),message[-200:])
    with timings.measure('inferenceAndBridge'):
        out=pipeline.infer(InferenceRequest(input_path=str(source),output_path=str(result/'working.mkv'),height=g['workHeight'],width=g['workWidth'],fps=float(Fraction(expected['fps']))),progress=update,video_preset='medium')
    if out.frames!=expected['frames']:raise ValueError('Upscaling changed frame count; output was kept for inspection.')
    progress(folder,90,'Restoring original framing and audio')
    final=result/'final.part.mp4'
    with timings.measure('finalEncoding'):
        subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-threads',str(threads),'-i',str(result/'working.mkv'),'-i',str(source),'-map','0:v:0','-map','1:a:0?',
            '-vf',export_filter(g,target),'-r',expected['fps'],'-fps_mode','cfr','-frames:v',str(expected['frames']),'-c:v','libx264','-crf','16','-preset','medium','-threads',str(threads),'-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(final)],check=True)
    if info(final)!={**expected,'width':target['outputWidth'],'height':target['outputHeight']}:raise ValueError('Final upscale timing or geometry failed verification.')
    def audio_hash(file):
        p=subprocess.run(['ffmpeg','-v','error','-i',str(file),'-map','0:a:0?','-c:a','copy','-f','data','-'],capture_output=True)
        if p.returncode and b'does not contain any stream'not in p.stderr:raise ValueError('Could not verify copied audio.')
        return hashlib.sha256(p.stdout).hexdigest()
    if audio_hash(source)!=audio_hash(final):raise ValueError('Original audio failed verification.')
    if sha(source)!=request['sourceSHA256']:raise ValueError('Source changed during upscaling.')
    final.replace(result/'final.mp4')
    receipt={'complete':True,'request':signature,'outputSHA256':sha(result/'final.mp4'),'frames':expected['frames'],'fps':expected['fps'],
        'width':target['outputWidth'],'height':target['outputHeight'],'workerSeconds':time.monotonic()-started,'attention':cfg.attn_kernel,'audioPreserved':True,'framingPreserved':True,
        'workerTotalSeconds':time.monotonic()-overall_started,'phaseSeconds':timings.seconds,'execution':{'input':'streamed-input-v1','cpuThreads':threads,'modelWidth':g['outputWidth'],'modelHeight':g['outputHeight'],**color_stats},
        'pipelineMetadata':out.metadata}
    atomic(result/'receipt.json',receipt)
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
