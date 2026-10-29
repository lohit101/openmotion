#!/usr/bin/env python3
"""Managed-host facial worker. Resumable per-frame output; no implicit setup."""
import argparse
import fcntl
from fractions import Fraction
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import uuid

from facial_runtime import ROOT, MODEL_ROOT, digest, inspect, link_models, paths, prepare, profile, profile_hash


def atomic(file, data):
    temporary = file.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(data) + '\n')
    temporary.replace(file)


def idle():
    port = json.loads((ROOT / 'config/server.json').read_text())['port']
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/queue', timeout=15) as response:
        queue = json.load(response)
    if queue.get('queue_running') or queue.get('queue_pending'):
        raise ValueError('The GPU has active ComfyUI work; facial processing did not start.')
    return port


def video_info(file):
    value = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,avg_frame_rate,nb_read_frames', '-of', 'json', str(file)]))['streams'][0]
    frames = int(value['nb_read_frames'])
    fps = Fraction(value['avg_frame_rate'])
    if frames < 1 or frames > 720 or fps != 24:
        raise ValueError('Facial consistency requires 1–720 decoded frames at native 24 fps. No timing was changed.')
    return {'width': int(value['width']), 'height': int(value['height']), 'frames': frames, 'fps': str(fps)}


def initialize():
    import torch
    import onnxruntime as ort
    ort.preload_dlls()
    source, _ = paths()
    sys.path.insert(0, str(source))
    os.chdir(source)
    from facefusion.program import create_program
    from facefusion.args import apply_args
    from facefusion import state_manager, inference_manager
    original = inference_manager.create_inference_session
    def checked(model, providers):
        session = original(model, providers)
        if session.get_providers()[0] != 'CUDAExecutionProvider':
            raise ValueError('CUDA failed for face dependency ' + Path(model).name)
        session.disable_fallback()
        return session
    inference_manager.create_inference_session = checked
    args = vars(create_program().parse_args(['headless-run', '--processors', 'face_swapper', '--face-swapper-model', 'hyperswap_1a_256',
        '--face-detector-model', 'yunet', '--face-landmarker-model', '2dfan4', '--face-occluder-model', 'xseg_1',
        '--face-mask-types', 'box', 'occlusion', '--execution-providers', 'cuda', '--execution-thread-count', '4']))
    apply_args(args, state_manager.init_item)
    state_manager.init_item('download_providers', [])


def face(frame):
    import numpy as np
    from facefusion import face_detector, face_landmarker
    from facefusion.face_helper import apply_nms, convert_to_face_landmark_5
    boxes, scores, _ = face_detector.detect_faces(frame)
    keep = apply_nms(boxes, scores, .6, .4)
    if len(keep) != 1:
        return None
    box = boxes[keep[0]]
    points, confidence = face_landmarker.detect_face_landmark(frame, box, 0)
    five = convert_to_face_landmark_5(points)
    if confidence < profile()['confidence'] or np.linalg.norm(five[1]-five[0]) < profile()['minimum_eye_distance']:
        return None
    return box, five, points


def preflight(folder):
    import cv2
    import numpy as np
    from facefusion import content_analyser
    from facefusion.face_recognizer import calculate_face_embedding
    request = json.loads((folder / 'request.json').read_text())
    version = request.get('version', 'source-face-v1')
    if request['profileSHA256'] != profile_hash(version) or request['profile'] not in profile()['profiles']:
        raise ValueError('The saved facial recipe does not match the installed tools.')
    expected = request['expected']
    if not all(isinstance(expected.get(key), int) for key in ['width', 'height', 'frames']) or not 1 <= expected['frames'] <= 720 or not all(64 <= expected[key] <= 4096 for key in ['width', 'height']):
        raise ValueError('Invalid expected facial video dimensions or frame count.')
    if __import__('shutil').disk_usage(folder).free < 5*1024**3 + expected['width']*expected['height']*expected['frames']*3:
        raise ValueError('Free more disk space for resumable face frames before rendering. No video sampling was submitted.')
    reference = folder / 'reference.png'
    if digest(reference) != request['referenceSHA256']:
        raise ValueError('The saved facial reference changed.')
    if content_analyser.analyse_image(str(reference)):
        raise ValueError('The unchanged upstream input check declined this reference.')
    found = face(cv2.imread(str(reference)))
    if found is None:
        raise ValueError('Use one clear face in the edited starting frame. Crop a character sheet before using it here.')
    _, embedding = calculate_face_embedding(cv2.imread(str(reference)), found[1])
    np.save(folder / 'donor.npy', embedding.astype(np.float32).reshape(1, 512))
    atomic(folder / 'preflight.json', {'profileSHA256': profile_hash(version), 'referenceSHA256': request['referenceSHA256'],
        'embeddingSHA256': digest(folder / 'donor.npy')})
    # Initialize the actual models now, before any new video sampling is paid for.
    from face_performance import FaceModels
    FaceModels(MODEL_ROOT, embedding)
    return {'ready': True, 'referenceSHA256': request['referenceSHA256'], 'profileSHA256': profile_hash(version)}


def running(folder):
    try:
        pid = json.loads((folder / 'pid.json').read_text())['pid']
        command = Path(f'/proc/{int(pid)}/cmdline').read_bytes()
        return b'facial_worker.py' in command and folder.name.encode() in command
    except (OSError, KeyError, ValueError):
        return False


def process(folder):
    import cv2
    import numpy as np
    import torch
    import onnxruntime as ort
    from facefusion import content_analyser
    from facefusion.face_helper import warp_face_by_face_landmark_5
    from facefusion.face_masker import create_occlusion_mask
    from face_performance import FaceModels, composite_face, face_permission
    request = json.loads((folder / 'request.json').read_text())
    inputs = json.loads((folder / 'inputs.json').read_text())
    version = request.get('version', 'source-face-v1')
    if inputs['request'] != request or request['profileSHA256'] != profile_hash(version):
        raise ValueError('The saved facial request changed; rendered media was preserved.')
    for key, filename in [('baseSHA256', 'target.mp4'), ('sourceSHA256', 'source.mp4'), ('referenceSHA256', 'reference.png')]:
        if digest(folder / filename) != inputs[key]:
            raise ValueError('A saved face-pass input changed: ' + filename)
    info = video_info(folder / 'target.mp4')
    source_info = video_info(folder / 'source.mp4')
    if any(info[key] != request['expected'][key] for key in ['width', 'height', 'frames']):
        raise ValueError('The rendered video differs from its frozen facial request; it was preserved.')
    if info['frames'] != source_info['frames'] or info['fps'] != source_info['fps']:
        raise ValueError('Source and generated video timing differ; no frames were invented or padded.')
    if info != inputs['target'] or source_info != inputs['source']:
        raise ValueError('Saved face-pass timing or dimensions changed.')
    signature = {**inputs, 'version': version}
    result = folder / 'result'
    result.mkdir(exist_ok=True)
    receipt_file = result / 'receipt.json'
    previous = json.loads(receipt_file.read_text()) if receipt_file.exists() else None
    if previous and previous['inputs'] != signature:
        raise ValueError('Saved facial frames belong to different inputs. They were preserved.')
    if previous and previous.get('complete') and (result / 'final.mp4').is_file() and digest(result / 'final.mp4') == previous['outputSHA256']:
        return previous
    records = previous['records'] if previous else []
    if not previous and any(result.glob('frame-*.png')):
        raise ValueError('Unreceipted facial frames exist; use a separate job instead of overwriting them.')
    for record in records:
        if record['frame'] >= info['frames'] or digest(result / f"frame-{record['frame']:06d}.png") != record['sha256']:
            raise ValueError('A previously saved facial frame changed.')
    for name in ['source.mp4', 'target.mp4']:
        if content_analyser.analyse_video(str(folder / name), 0, info['frames']):
            raise ValueError('The unchanged upstream input check declined the video.')
    pre = json.loads((folder / 'preflight.json').read_text())
    if pre['referenceSHA256'] != inputs['referenceSHA256'] or digest(folder / 'donor.npy') != pre['embeddingSHA256']:
        raise ValueError('The fixed reference-face conditioning changed.')
    models = FaceModels(MODEL_ROOT, np.load(folder / 'donor.npy'))
    receipt = {'inputs': signature, 'complete': False, 'records': records, 'gpu': models.gpu, 'onnxruntime': ort.__version__,
        'providers': {key: session.get_providers() for key, session in models.sessions.items()}, 'elapsedSeconds': previous.get('elapsedSeconds', 0) if previous else 0,
        'profile': request['profile'], 'blend': .6, 'sourceGeometryMapping': {'from': [source_info['width'], source_info['height']], 'to': [info['width'], info['height']]}}
    elapsed = receipt['elapsedSeconds']
    started = time.monotonic()
    target = cv2.VideoCapture(str(folder / 'target.mp4'))
    source = cv2.VideoCapture(str(folder / 'source.mp4'))
    def pose(five):
        eyes = five[1]-five[0]
        distance = np.linalg.norm(eyes)
        h = eyes / distance
        v = np.array([-h[1], h[0]])
        nose = (five[2]-(five[0]+five[1])/2)/distance
        return np.array([nose @ h, nose @ v])
    for index in range(info['frames']):
        if (result / 'CANCEL').exists():
            raise ValueError('Facial processing cancelled; completed frames were kept.')
        idle()
        ok, frame = target.read()
        source_ok, original = source.read()
        if not ok or not source_ok:
            raise ValueError('A decoder ended early; no paid video inference was repeated.')
        if index < len(records):
            if records[index]['frame'] != index:
                raise ValueError('Facial resume frames are out of order.')
            continue
        if original.shape[:2] != frame.shape[:2]:
            original = cv2.resize(original, (info['width'], info['height']), interpolation=cv2.INTER_AREA)
        source_face, target_face = face(original), face(frame)
        edited = frame
        record = {'frame': index, 'action': 'preserved', 'reason': 'uncertain-or-multiple-face', 'protectedPixelsExact': True}
        if source_face is not None and target_face is not None:
            gap = np.abs(pose(source_face[1])-pose(target_face[1]))
            if gap[0] <= .25 and gap[1] <= .35:
                driver, sm = warp_face_by_face_landmark_5(original, source_face[1], 'arcface_128', (512, 512))
                crop, tm = warp_face_by_face_landmark_5(frame, target_face[1], 'arcface_128', (512, 512))
                permission = cv2.warpAffine(face_permission(frame, target_face[0]), tm, (512, 512))
                permission = np.minimum(permission, create_occlusion_mask(crop)).clip(0, 1)
                # Source occlusions can only remove editing permission.
                permission = np.minimum(permission, create_occlusion_mask(driver)).clip(0, 1)
                if permission.sum() >= 1:
                    corrected = models.correct(driver, crop, permission, request['profile'] == 'regional-onnx60')
                    if version == 'source-face-v2':
                        from scene_face_composite import composite_scene_face
                        edited = composite_scene_face(frame, crop, corrected, tm, permission)
                    else:
                        edited = composite_face(frame, corrected, tm, permission)
                    record.update(action='refined', reason=None)
                else:
                    record['reason'] = 'face-occluded'
            else:
                record['reason'] = 'source-output-pose-mismatch'
        destination = result / f'frame-{index:06d}.png'
        temporary = destination.with_name(destination.stem + '.tmp.png')
        if not cv2.imwrite(str(temporary), edited):
            raise ValueError('A corrected facial frame could not be saved.')
        temporary.replace(destination)
        record['sha256'] = digest(destination)
        records.append(record)
        receipt['elapsedSeconds'] = elapsed + time.monotonic()-started
        atomic(receipt_file, receipt)
        print(json.dumps({'frame': index+1, 'frames': info['frames'], 'stage': 'Matching source expressions and facial identity'}), flush=True)
    if target.read()[0] or source.read()[0]:
        raise ValueError('A decoder produced extra frames; no timing changes were accepted.')
    target.release()
    source.release()
    print(json.dumps({'frame': info['frames'], 'frames': info['frames'], 'stage': 'Saving facial consistency result'}), flush=True)
    for record in records:
        if digest(result / f"frame-{record['frame']:06d}.png") != record['sha256']:
            raise ValueError('A saved facial frame changed before export.')
    partial = result / 'final.part.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-nostdin', '-y', '-framerate', info['fps'], '-i', str(result / 'frame-%06d.png'),
        '-i', str(folder / 'target.mp4'), '-map', '0:v:0', '-map', '1:a?', '-frames:v', str(info['frames']),
        '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', str(partial)], check=True)
    if video_info(partial) != info:
        raise ValueError('Corrected video timing changed; saved frames were retained.')
    partial.replace(result / 'final.mp4')
    receipt.update(complete=True, outputSHA256=digest(result / 'final.mp4'), elapsedSeconds=elapsed+time.monotonic()-started,
        refinedFrames=sum(r['action'] == 'refined' for r in records), skippedFrames=sum(r['action'] != 'refined' for r in records))
    atomic(receipt_file, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['status', 'prepare', 'preflight', 'launch', 'poll', 'cancel', 'worker'])
    parser.add_argument('--job')
    args = parser.parse_args()
    (ROOT / 'state').mkdir(parents=True, exist_ok=True)
    if args.action == 'status':
        value = inspect()
    elif args.action == 'prepare':
        idle()
        prepare()
        value = inspect()
    else:
        job = str(uuid.UUID(args.job))
        folder = ROOT / 'jobs' / job
        if not folder.is_dir():
            raise ValueError('Facial request is not prepared.')
        if args.action == 'cancel':
            (folder / 'result').mkdir(exist_ok=True)
            (folder / 'result/CANCEL').touch()
            value = {'running': running(folder)}
        elif args.action == 'poll':
            state = folder / 'worker.json'
            value = json.loads(state.read_text()) if state.exists() else {'state': 'starting'}
            value['running'] = running(folder)
            receipt = folder / 'result/receipt.json'
            if receipt.exists():
                r = json.loads(receipt.read_text())
                value.update(frame=len(r['records']), frames=r['inputs']['target']['frames'])
            if not value['running'] and value['state'] not in ['completed', 'interrupted']:
                value.update(state='interrupted', error='The facial worker stopped; saved frames remain on this instance.')
        elif args.action == 'launch':
            with (folder / 'launch.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX)
                if not running(folder):
                    idle()
                    if not inspect(verify=True)['ready']:
                        raise ValueError('Download the selected facial tools first. Generate never installs models.')
                    frames = json.loads((folder / 'inputs.json').read_text())['target']
                    if __import__('shutil').disk_usage(folder).free < 5*1024**3 + frames['width']*frames['height']*frames['frames']*3:
                        raise ValueError('Insufficient disk space for resumable facial frames; the rendered video was kept.')
                    (folder / 'result').mkdir(exist_ok=True)
                    (folder / 'result/CANCEL').unlink(missing_ok=True)
                    (folder / 'worker.json').unlink(missing_ok=True)
                    with (folder / 'worker.log').open('ab') as log:
                        child = subprocess.Popen([str(paths()[1]), '-u', str(Path(__file__).resolve()), 'worker', '--job', job],
                            stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
                    atomic(folder / 'pid.json', {'pid': child.pid})
            value = {'launched': True}
        else:
            idle()
            if not inspect(verify=True)['ready']:
                raise ValueError('Selected facial weights or runtime are missing. Nothing was installed.')
            initialize()
            if args.action == 'preflight':
                value = preflight(folder)
            else:
                with (ROOT / 'state/processing.lock').open('a') as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    try:
                        atomic(folder / 'worker.json', {'state': 'running'})
                        process(folder)
                        atomic(folder / 'worker.json', {'state': 'completed'})
                    except BaseException as error:
                        atomic(folder / 'worker.json', {'state': 'interrupted', 'error': str(error)[-1200:]})
                        raise
                return
    print('RECAST_FACIAL ' + json.dumps(value), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
