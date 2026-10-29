#!/usr/bin/env python3
"""Explicit facial refinement of a saved video. No model downloads on run.

Preserves the parent, writes a separate resumable frame sequence and result, and
records every skipped face. CPU is the default; CUDA is opt-in on managed hosts.
This corrects visible facial appearance; it cannot
recover a missing performance, hidden profile or facial detail absent in references.
"""
import argparse
from fractions import Fraction
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

from local_identity import ROOT, digest, locations, setup as base_setup, status as base_status
from video_timing import decoded_video_info

LOCK = ROOT / 'config/local-video-identity.lock.json'


def status(verify=False):
    result = base_status(verify)
    config, source, _ = locations()
    extra = json.loads(LOCK.read_text())
    for item in extra['files']:
        file = source / item['path']
        result['bytes'] += item['size']
        if not file.is_file() or file.stat().st_size != item['size'] or verify and digest(file) != item['sha256']:
            result['missing'].append(Path(item['path']).name)
        else:
            result['readyBytes'] += item['size']
    result.update(ready=not result['missing'], setup='python3 scripts/video_identity.py setup', license=extra['usage'])
    return result


def setup(python=None):
    base_setup(python)
    _, source, _ = locations()
    for item in json.loads(LOCK.read_text())['files']:
        file = source / item['path']
        if file.is_file() and file.stat().st_size == item['size'] and digest(file) == item['sha256']:
            continue
        partial = file.with_suffix(file.suffix + '.part')
        print('Downloading explicit local face-refinement dependency: ' + file.name, file=sys.stderr, flush=True)
        with urllib.request.urlopen(item['url'], timeout=60) as response, partial.open('wb') as output:
            shutil.copyfileobj(response, output, 1024 * 1024)
        if partial.stat().st_size != item['size'] or digest(partial) != item['sha256']:
            raise ValueError('Local face-refinement checksum mismatch; partial retained.')
        os.replace(partial, file)
    return status(verify=True)


def video_info(file, expected_fps=None):
    data = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_streams',
                      '-show_frames', '-show_entries', 'stream=width,height,avg_frame_rate:frame=best_effort_timestamp_time', '-of', 'json', str(file)]))
    return decoded_video_info(data, expected_fps)


def face_permission(frame, box):
    """Limit changes to a feathered facial oval; exact zero outside a finite ROI."""
    import cv2
    import numpy as np
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = [float(x) for x in box]
    w, h = x2 - x1, y2 - y1
    left, top = max(0, math.floor(x1 - .1*w)), max(0, math.floor(y1 - .06*h))
    right, bottom = min(width, math.ceil(x2 + .1*w)), min(height, math.ceil(y2 + .08*h))
    mask = np.zeros((height, width), dtype=np.float32)
    cv2.ellipse(mask, (round((x1+x2)/2), round(y1+.51*h)), (max(1, round(.58*w)), max(1, round(.58*h))), 0, 0, 360, 1., -1)
    mask = cv2.GaussianBlur(mask, (0,0), max(1., w*.025))
    allowed = np.zeros_like(mask); allowed[top:bottom,left:right] = mask[top:bottom,left:right]
    return allowed


def run(reference, target, output, provider='cpu', method='direct', performance_source=None):
    invocation_started = time.monotonic()
    ready = status(verify=True)
    if not ready['ready']:
        raise ValueError('Local face refinement is not installed. Run ' + ready['setup'] + '. Nothing was downloaded or sent to a GPU.')
    reference, target, output = [Path(x).resolve() for x in (reference, target, output)]
    if output == target or output == reference or output in target.parents or output in reference.parents:
        raise ValueError('Keep the refinement output in a separate directory from its inputs.')
    info = video_info(target)
    if method not in ['direct','source-performance'] or bool(performance_source)!=(method=='source-performance'):
        raise ValueError('Source-performance swap requires its exact prepared source video; direct swap takes no extra motion input.')
    performance_source=Path(performance_source).resolve() if performance_source else None
    if performance_source and (output==performance_source or output in performance_source.parents):
        raise ValueError('Keep the face-swap output separate from its source-performance input.')
    if performance_source and video_info(performance_source)!=info:
        raise ValueError('Source performance and generated video must have identical dimensions, frame count and timing. No padding, offsets or inference were added.')
    output.mkdir(parents=True, exist_ok=True)
    receipt_file = output/'identity-video.json'
    signature = {'version': 'face-finish-v1', 'profile': digest(LOCK), 'baseProfile': digest(ROOT/'config/local-identity.lock.json'),
                 'parentSHA256': digest(target), 'referenceSHA256': digest(reference), **info}
    if performance_source:
        from source_face_performance import PROFILE
        signature.update(version='face-source-v1',method=method,performanceSHA256=digest(performance_source),performanceProfile=digest(PROFILE))
    if provider == 'cuda':
        signature.update(provider='cuda', gpuProfile=digest(ROOT/'config/gpu-video-identity.lock.json'))
    records = []; previous_elapsed = 0
    if receipt_file.exists():
        previous = json.loads(receipt_file.read_text())
        if previous['inputs'] != signature:
            raise ValueError('Existing refinement belongs to different inputs/settings; preserve it and use another directory.')
        records = previous['records']
        previous_elapsed = previous.get('elapsedSeconds', 0)
        if previous.get('complete') and (output/'final.mp4').is_file() and digest(output/'final.mp4') == previous.get('outputSHA256'):
            return previous
    elif any(output.glob('frame-*.png')) or (output/'final.mp4').exists():
        raise ValueError('Unreceipted output files already exist; preserve them and use another directory.')
    config, source, _ = locations()
    sys.path.insert(0, str(source)); os.chdir(source)
    import cv2
    import numpy as np
    session_providers = {}
    if provider == 'cuda':
        # Reuse the matching CUDA libraries already supplied by the engine's
        # PyTorch environment. Never accept silent whole-model CPU fallback.
        import torch
        import onnxruntime as ort
        if not torch.cuda.is_available() or 'CUDAExecutionProvider' not in ort.get_available_providers():
            raise ValueError('CUDA face refinement is unavailable. No CPU fallback was started.')
        ort.preload_dlls()
    from facefusion.program import create_program
    from facefusion.args import apply_args
    from facefusion import state_manager, content_analyser
    from facefusion.face_creator import get_static_faces
    from facefusion.processors.modules.face_swapper.core import swap_face
    if provider == 'cuda':
        from facefusion import inference_manager
        original_session = inference_manager.create_inference_session
        def checked_session(model_path, providers):
            session = original_session(model_path, providers)
            actual = session.get_providers()
            if 'CUDAExecutionProvider' not in actual:
                raise ValueError('CUDA session failed for ' + Path(model_path).name + '; CPU fallback is not allowed.')
            session.disable_fallback()
            session_providers[Path(model_path).name] = actual
            return session
        inference_manager.create_inference_session = checked_session
    args = vars(create_program().parse_args(['headless-run', '--processors', 'face_swapper', '--face-swapper-model', 'hyperswap_1a_256',
            '--face-swapper-pixel-boost','512x512','--face-swapper-weight','0.5','--face-detector-model','yunet',
            '--face-mask-types','box','occlusion','--face-occluder-model','xseg_1','--face-mask-blur','0.3',
            '--execution-providers',provider,'--execution-thread-count','4']))
    apply_args(args, state_manager.init_item);state_manager.init_item('download_providers', [])
    if content_analyser.analyse_image(str(reference)) or content_analyser.analyse_video(str(target), 0, info['frames']) or performance_source and content_analyser.analyse_video(str(performance_source),0,info['frames']):
        raise ValueError('Unmodified upstream media check declined an input. The parent remains unchanged.')
    donor = cv2.imread(str(reference))
    if donor is None: raise ValueError('Reference image could not be decoded.')
    donors = get_static_faces([donor])
    if len(donors) != 1: raise ValueError('Use one clear reference face; a character sheet must be cropped to an individual view.')
    cap = cv2.VideoCapture(str(target)); started = invocation_started; elapsed_before = previous_elapsed
    source_cap=cv2.VideoCapture(str(performance_source)) if performance_source else None
    result = {'inputs': signature, 'execution': 'remote CUDA' if provider == 'cuda' else 'local CPU', 'newPaidInference': provider == 'cuda', 'model': 'hyperswap_1a_256',
              'contentCheck': 'unchanged upstream image/video checks', 'usage': ready['license'], 'records': records, 'complete': False}
    if provider == 'cuda':
        result.update(gpu=torch.cuda.get_device_name(0), onnxruntime=ort.__version__, sessionProviders=session_providers)
    def save():
        temporary=receipt_file.with_suffix('.tmp.json'); temporary.write_text(json.dumps(result, indent=2)+'\n');os.replace(temporary, receipt_file)
    save()
    for index in range(info['frames']):
        if (output/'CANCEL').exists():
            raise ValueError('GPU refinement cancelled; saved frames were kept.')
        ok, frame = cap.read()
        if not ok: raise ValueError('Decoder ended before the validated frame count. No padding or paid rerender was requested.')
        source_frame=None
        if source_cap:
            source_ok,source_frame=source_cap.read()
            if not source_ok:raise ValueError('Performance source ended before its validated frame count. No missing frames were invented.')
        file=output/f'frame-{index:06d}.png'
        if index < len(records):
            if records[index]['frame'] != index or not file.is_file() or digest(file) != records[index]['sha256']:
                raise ValueError('A previously saved refinement frame changed. Existing results were preserved.')
            continue
        before=time.monotonic();faces=get_static_faces([frame]);edited=frame
        record={'frame':index,'action':'preserved'}
        if len(faces) == 1 and faces[0].score_set['landmarker'] >= .65:
            swapped=swap_face(donors[0],faces[0],donor,frame.copy())
            mask=face_permission(frame,faces[0].bounding_box)
            edited=np.rint(swapped*mask[...,None]+frame*(1-mask[...,None])).clip(0,255).astype(np.uint8)
            if np.any(edited[mask==0] != frame[mask==0]): raise ValueError('Protected pixels changed before encoding.')
            record.update(action='refined', protectedPixelsExact=True)
            if source_cap:
                from source_face_performance import compatible_faces,transfer_features
                source_faces=get_static_faces([source_frame])
                reason=compatible_faces(source_faces[0],faces[0]) if len(source_faces)==1 else 'ambiguous-or-missing-source-face'
                if reason:record.update(performance='identity-only',reason=reason)
                else:
                    swapped_source=swap_face(donors[0],source_faces[0],donor,source_frame.copy())
                    edited,performance=transfer_features(source_frame,source_faces[0],swapped_source,frame,faces[0],edited)
                    record.update(performance)
        else:
            record['reason']='ambiguous-or-low-confidence-face' if faces else 'no-clear-face'
        temporary=file.with_name(file.stem+'.tmp.png')
        if not cv2.imwrite(str(temporary),edited): raise ValueError('Refined frame could not be saved.')
        os.replace(temporary,file);record.update(sha256=digest(file),seconds=time.monotonic()-before);records.append(record)
        result['elapsedSeconds']=elapsed_before+time.monotonic()-started;save()
        print(json.dumps({'frame':index+1,'frames':info['frames'],'stage':'Refining facial identity','action':record['action']}),flush=True)
    if cap.read()[0]: raise ValueError('Decoder produced extra frames; original timing was retained for review.')
    cap.release()
    if source_cap:
        if source_cap.read()[0]:raise ValueError('Performance source has extra frames; source/output timing must match exactly.')
        source_cap.release()
    # Verify the complete saved sequence on its execution machine before export.
    for record in records:
        if digest(output/f"frame-{record['frame']:06d}.png") != record['sha256']:
            raise ValueError('A saved refinement frame changed before export.')
    final=output/'final.mp4';partial=output/'final.part.mp4'
    subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-framerate',info['fps'],'-i',str(output/'frame-%06d.png'),
             '-i',str(target),'-map','0:v:0','-map','1:a?','-frames:v',str(info['frames']),'-c:v','libx264','-preset','medium',
             '-crf','16','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(partial)],check=True)
    if video_info(partial) != info: raise ValueError('Refined output timing or dimensions differ; original and frames were preserved.')
    os.replace(partial,final)
    result.update(complete=True, outputSHA256=digest(final), elapsedSeconds=elapsed_before+time.monotonic()-started,
                  framesVerified=True, refinedFrames=sum(x['action']=='refined' for x in records), skippedFrames=sum(x['action']!='refined' for x in records))
    if performance_source:
        result.update(performanceFrames=sum(x.get('performance')=='source-features' for x in records),fallbackFrames=sum(x.get('performance')=='identity-only' for x in records))
    save();return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['status','setup','run']);parser.add_argument('--python')
    parser.add_argument('--reference');parser.add_argument('--target');parser.add_argument('--output');parser.add_argument('--provider',choices=['cpu','cuda'],default='cpu')
    parser.add_argument('--method',choices=['direct','source-performance'],default='direct');parser.add_argument('--performance-source');args=parser.parse_args()
    if args.action=='status': result=status()
    elif args.action=='setup': result=setup(args.python)
    else:
        if not all([args.reference,args.target,args.output]): raise ValueError('Reference, target and output directory are required.')
        result=run(args.reference,args.target,args.output,args.provider,args.method,args.performance_source)
    print(json.dumps({key:value for key,value in result.items() if key!='records'}),flush=True)


if __name__=='__main__':
    try: main()
    except (ValueError,OSError,subprocess.SubprocessError) as error:
        print(str(error),file=sys.stderr);sys.exit(1)
