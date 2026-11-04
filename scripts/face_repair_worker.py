#!/usr/bin/env python3
"""Detached, resumable selected-frame repair; never modifies a paid parent."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

from facial_runtime import ROOT, MODEL_ROOT, digest, inspect, paths, profile_hash
from face_repair import VERSION, fingerprint, validate_request, selected_frames, temporal_weight, composite_layer
from facial_worker import atomic, face, idle, initialize, video_info


def running(folder):
    try:
        pid = json.loads((folder/'pid.json').read_text())['pid']
        command = Path(f'/proc/{int(pid)}/cmdline').read_bytes()
        return b'face_repair_worker.py' in command and folder.name.encode() in command
    except (OSError, ValueError, KeyError):
        return False


def cancelled(folder):
    if (folder/'result/CANCEL').exists():
        raise ValueError('Face repair cancelled; verified frames and original video were kept.')
    idle()
    return False


def progress(folder, frame, frames, stage):
    value = {'frame': frame, 'frames': frames, 'stage': stage}
    atomic(folder/'result/progress.json', value)
    print('RECAST_FACE_REPAIR_PROGRESS '+json.dumps(value), flush=True)


def png(file, pixels):
    import cv2
    temporary = file.with_name(file.stem+'.tmp.png')
    if not cv2.imwrite(str(temporary), pixels):
        raise ValueError('A repair frame could not be saved.')
    temporary.replace(file)


def verify_inputs(folder, request):
    validate_request(request)
    names = {'finishedSHA256': 'finished.mp4', 'rawSHA256': 'raw.mp4', 'sourceSHA256': 'source.mp4',
             'referenceSHA256': 'reference.png', 'parentReceiptSHA256': 'parent-receipt.json',
             'parentCalibrationSHA256': 'parent-calibration.json'}
    for key, name in names.items():
        file = folder/name
        if file.is_symlink() or not file.is_file() or digest(file) != request['binding'][key]:
            raise ValueError('A frozen repair input changed: '+name)
    infos = {name: video_info(folder/(name+'.mp4')) for name in ('finished', 'raw', 'source')}
    expected = {key: request[key] for key in ('width', 'height', 'frames')}
    if any(infos[role][key] != expected[key] for role in ('finished', 'raw') for key in expected):
        raise ValueError('The parent output dimensions or frame count changed.')
    if any(info['frames'] != request['frames'] or info['fps'] != infos['raw']['fps'] for info in infos.values()):
        raise ValueError('Source, raw and finished video do not share one exact frame clock.')
    receipt = json.loads((folder/'parent-receipt.json').read_text())
    calibration = json.loads((folder/'parent-calibration.json').read_text())
    inherited = {'jobId': request['rootJobId'], 'version': request['parent']['version'],
                 'profileSHA256': request['binding']['parentProfileSHA256'],
                 'sourceSHA256': request['binding']['sourceSHA256'],
                 'referenceSHA256': request['binding']['referenceSHA256'],
                 'anchorFrame': request['parent']['anchorFrame']}
    if calibration.get('binding') != inherited:
        raise ValueError('The inherited calibration belongs to another original render.')
    if not receipt.get('complete') or receipt.get('inputs', {}).get('baseSHA256') != request['binding']['rawSHA256']:
        raise ValueError('The inherited facial receipt does not bind the original raw animation.')
    parent_inputs = receipt['inputs']
    original_request = parent_inputs.get('request',{})
    expected_request = {'jobId':request['rootJobId'],'version':request['parent']['version'],
                        'profile':request['parent']['profile'],'profileSHA256':request['binding']['parentProfileSHA256'],
                        'referenceSHA256':request['binding']['referenceSHA256'],'anchorFrame':request['parent']['anchorFrame']}
    if any(original_request.get(k) != v for k,v in expected_request.items()):
        raise ValueError('The inherited facial request belongs to another reference, anchor or original job.')
    if any(parent_inputs.get(key) != request['binding'][key] for key in ('sourceSHA256','referenceSHA256')):
        raise ValueError('The inherited source or reference differs from the original facial receipt.')
    if any(parent_inputs.get(role) != infos[role] for role in ('source',)) or parent_inputs.get('target') != infos['raw']:
        raise ValueError('The inherited source or raw frame clock differs from its original receipt.')
    if request['parentJobId'] == request['rootJobId'] and receipt.get('outputSHA256') != request['binding']['finishedSHA256']:
        raise ValueError('The finished parent differs from its original completed facial receipt.')
    if receipt.get('calibration', {}).get('fileSHA256') != request['binding']['parentCalibrationSHA256']:
        raise ValueError('The inherited calibration checksum differs from its original receipt.')
    if receipt.get('inputs', {}).get('request', {}).get('profileSHA256') != request['binding']['parentProfileSHA256']:
        raise ValueError('The parent recipe checksum differs from its original receipt.')
    return infos, calibration


def candidate_warnings(receipt, changed):
    if not changed:
        return ['No safely editable face was found; the parent was preserved.']
    warnings = ['Compare both joins in motion before accepting.']
    preserved = sum(row['weight'] > 0 and row.get('reason') not in (None,'outside-editable-range') for row in receipt['records'])
    if preserved:
        warnings.append(f'{preserved} editable frames were preserved because the face or foreground could not be verified.')
    warnings.append('Existing face pixels drawn over foreground or outside the admitted face area may remain; review before accepting.')
    return warnings


class CapturedModels:
    """Reuse exact old performance math and retain separate prediction planes."""
    def __init__(self, models):
        self.models = models
        self.expression = self.swapped = None

    def __getattr__(self, name):
        return getattr(self.models, name)

    def identity(self, expression, permission):
        self.expression = expression.copy()
        self.swapped = self.models.identity(expression, permission)
        return self.swapped

    def correct(self, driver, target, permission, regional):
        import numpy as np
        expression = self.models.expression(driver, target, regional)
        identity = self.identity(expression, permission)
        return np.rint(.6*identity+.4*expression).clip(0,255).astype(np.uint8)


def corrector(models, parser, inherited):
    captured = CapturedModels(models)
    state = inherited['metadata']['state']
    if state == 'active':
        from face_eye_calibration import EyeCalibration, EyeCalibratedModels
        selected = EyeCalibratedModels(captured, parser, EyeCalibration.restore(inherited['model']))
    elif state == 'skipped' and inherited.get('model') is None:
        selected = captured
    else:
        raise ValueError('The inherited eye calibration is not recoverable.')
    return captured, selected


def tracking(folder, request, info):
    """New child-owned analysis of actual canonical output, never fake inheritance."""
    from face_occlusion_tracking import prepare_occlusion
    target = folder/'target.mp4'
    if target.exists():
        if digest(target) != request['binding']['finishedSHA256']:
            raise ValueError('The canonical tracking target changed.')
    else:
        os.link(folder/'finished.mp4', target)
    bound = {'jobId': request['jobId'], 'version': 'source-face-v11', 'profileSHA256': profile_hash('source-face-v11')}
    inputs = {'request': bound, 'sourceSHA256': request['binding']['sourceSHA256'],
              'baseSHA256': request['binding']['finishedSHA256'], 'referenceSHA256': request['binding']['referenceSHA256']}
    def update(n, total, stage):
        progress(folder, n, total, stage+' for selected repair')
    return prepare_occlusion(folder, inputs, info, face, update, lambda: cancelled(folder), model_root=MODEL_ROOT)


def frame_layers(raw, source, finished, observed, models, parser, retained_eyes):
    """Infer once from raw, then construct permission against canonical pixels."""
    import cv2
    import numpy as np
    from facefusion.face_helper import warp_face_by_face_landmark_5
    from facefusion.face_masker import create_occlusion_mask
    from face_eye_calibration import matching_pose
    from face_feature_cleanup import FACE_CLASSES, FEATURE_CLASSES, source_eye_gates, restore_eye_detail, match_lighting
    from face_jaw_geometry import jaw_masks
    from face_boundary_blend import boundary_plane
    source_face, parent_face, raw_face = observed['sourceFace'], observed['targetFace'], face(raw)
    if observed['targetMaskState'] not in ('known-none', 'segmented'):
        return None, 'canonical-foreground-unavailable'
    if source_face is None or parent_face is None or raw_face is None:
        return None, 'uncertain-or-multiple-face'
    if not matching_pose(source_face[1], raw_face[1]) or not matching_pose(parent_face[1], raw_face[1]):
        return None, 'source-or-parent-pose-mismatch'
    driver, sm = warp_face_by_face_landmark_5(source, source_face[1], 'arcface_128', (512,512))
    crop, matrix = warp_face_by_face_landmark_5(raw, raw_face[1], 'arcface_128', (512,512))
    parent_crop = cv2.warpAffine(finished, matrix, (512,512))
    raw_labels, source_labels, parent_labels = parser(crop), parser(driver), parser(parent_crop)
    points = cv2.transform(source_face[2].reshape(1,68,2), sm)[0]
    occlusion = np.minimum(create_occlusion_mask(crop), create_occlusion_mask(parent_crop)).clip(0,1)
    source_occlusion = create_occlusion_mask(driver).clip(0,1)
    corrected = models.correct(driver, crop, np.ones((512,512),np.float32), False)
    captured = models.models if hasattr(models, 'calibration') else models
    expression, identity = captured.expression, captured.swapped
    if expression is None or identity is None:
        raise ValueError('The face model did not retain separate correction layers.')
    labels = parser(corrected)
    scale = float(np.hypot(matrix[0,0], matrix[1,0]))
    alpha, skin, jaw = jaw_masks(raw_labels, labels, occlusion, source_labels, source_occlusion, points, scale)
    # A prediction never grants permission over canonical hair/accessories or
    # background.  Parent semantic analysis is explicit, not MP4 subtraction.
    canonical_face = np.isin(parent_labels, FACE_CLASSES)
    canonical_occ = create_occlusion_mask(parent_crop).clip(0,1)
    alpha = np.minimum(alpha, canonical_occ)*canonical_face
    if retained_eyes:
        eye = np.isin(parent_labels, (2,3,4,5)).astype(np.uint8)
        eye = cv2.dilate(eye, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7))) > 0
        alpha[eye] = 0
    gates = source_eye_gates(source_labels, points)
    corrected, _ = restore_eye_detail(crop, corrected, labels, occlusion, gates)
    support = (raw_labels == 14) & (labels == 1) & (alpha > 0) if jaw['supportPixels'] else None
    corrected = match_lighting(parent_crop, corrected, skin*canonical_face, scale)
    boundary, boundary_alpha, detail = boundary_plane(parent_crop, corrected, alpha, labels, scale, support, strength=.9)
    # Boundary candidate edits a peripheral skin band only, leaving complete
    # performance features untouched.  Identity candidate owns complete face.
    distance = cv2.distanceTransform(canonical_face.astype(np.uint8), cv2.DIST_L2,5)
    band = np.clip(1-distance/max(8.,18*scale),0,1)
    protected_features = np.isin(parent_labels, (*FEATURE_CLASSES,10)).astype(np.uint8)
    protected_features = cv2.dilate(protected_features,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9))) > 0
    band[protected_features] = 0
    stronger = np.rint(.8*identity+.2*expression).clip(0,255).astype(np.uint8)
    stronger, _ = restore_eye_detail(crop,stronger,labels,occlusion,gates)
    stronger = match_lighting(parent_crop,stronger,skin*canonical_face,scale)
    stronger, strong_alpha, _ = boundary_plane(parent_crop,stronger,alpha,labels,scale,support,strength=.9)
    return {'boundary':boundary, 'boundaryAlpha':boundary_alpha*band, 'identity80':stronger,
            'identity80Alpha':strong_alpha, 'matrix':matrix, 'expression':expression, 'identity':identity,
            'sourceMatrix':sm, 'sourceEyeGates':gates, 'jaw':jaw, 'boundaryDetail':detail,
            'rawCrop':crop,'sourceCrop':driver,'parentCrop':parent_crop,
            'rawLabels':raw_labels,'sourceLabels':source_labels,'parentLabels':parent_labels,'predictedLabels':labels,
            'permission':alpha,'skin':skin,'sourceLandmarks':points,'occlusion':occlusion,
            'sourceOcclusion':source_occlusion,'jawSupport':support if support is not None else np.zeros((512,512),bool)}, None


def project_layer(layer, alpha, matrix, size):
    import cv2
    import numpy as np
    inverse = cv2.invertAffineTransform(matrix)
    permission = cv2.warpAffine(alpha, inverse, size).clip(0,1)
    permission *= cv2.warpAffine(np.float32(alpha > 0),inverse,size,flags=cv2.INTER_NEAREST)
    return cv2.warpAffine(layer,inverse,size), permission


def audio_packets(file):
    value = json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a',
        '-show_packets','-show_data_hash','sha256','-show_entries','packet=data_hash', '-of','json',str(file)]))
    return [p['data_hash'] for p in value.get('packets',[])]


def audio_signature(file):
    value = json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','a',
        '-show_packets','-show_data_hash','sha256','-show_entries',
        'packet=pts_time,dts_time,duration_time,data_hash:packet_side_data=side_data_type,skip_samples,discard_padding,skip_reason,discard_reason',
        '-of','json',str(file)]))
    return value.get('packets',[])


def audio_pcm(file):
    if not audio_packets(file):
        return None
    child = subprocess.Popen(['ffmpeg','-v','error','-nostdin','-i',str(file),'-map','0:a:0',
                              '-c:a','pcm_f32le','-f','f32le','pipe:1'],stdout=subprocess.PIPE)
    h, size = hashlib.sha256(), 0
    with child.stdout:
        for data in iter(lambda:child.stdout.read(1024*1024),b''):
            h.update(data)
            size += len(data)
    if child.wait():
        raise ValueError('Original audio could not be verified.')
    return {'sha256':h.hexdigest(),'bytes':size}


def verify_clock(file, request):
    info = video_info(file)
    if any(info[k] != request[k] for k in ('frames','width','height')) or info['fps'] != '24':
        raise ValueError('Repair export altered original timing or dimensions.')
    data = json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-show_frames',
        '-show_entries','frame=best_effort_timestamp_time','-of','json',str(file)]))
    times = [float(x['best_effort_timestamp_time']) for x in data['frames']]
    if abs(times[0]) > .001 or any(abs(t-i/24) > .001 for i,t in enumerate(times)):
        raise ValueError('Repair export moved the absolute parent frame clock.')


CANONICAL_DECODER = 'ffmpeg-bgr24-accurate-bitexact-v1'


def decoded_frames(file, width, height, count):
    """One declared canonical decode policy, independent of OpenCV's build."""
    child = subprocess.Popen(['ffmpeg','-v','error','-nostdin','-threads','1','-flags','+bitexact','-i',str(file),
        '-map','0:v:0','-fps_mode','passthrough','-sws_flags','accurate_rnd+bitexact',
        '-f','rawvideo','-pix_fmt','bgr24','pipe:1'],stdout=subprocess.PIPE)
    try:
        with child.stdout:
            for _ in range(count):
                pixels = child.stdout.read(width*height*3)
                if len(pixels) != width*height*3:
                    raise ValueError('A repair verification decoder ended early.')
                yield pixels
            if child.stdout.read(1):
                raise ValueError('A repair verification decoder produced trailing pixels.')
        if child.wait():
            raise ValueError('A repair verification decoder failed.')
    except BaseException:
        if child.poll() is None:
            child.terminate()
        child.wait()
        raise


def decoded_hashes(file, width, height, count):
    """Verify BGR decoded pixels without a local Python ML stack."""
    return [hashlib.sha256(pixels).hexdigest() for pixels in decoded_frames(file,width,height,count)]


def export_candidate(folder, request, candidate, frame_hashes):
    result = folder/'result'
    frames = result/candidate
    master = result/f'candidate-{candidate}.mkv'
    preview = result/f'candidate-{candidate}.mp4'
    common = ['ffmpeg','-v','error','-nostdin','-y','-framerate','24','-i',str(frames/'frame-%06d.png'),
              '-i',str(folder/'finished.mp4'),'-map','0:v:0','-map','1:a?','-frames:v',str(request['frames'])]
    subprocess.run([*common,'-c:v','ffv1','-threads','2','-level','3','-pix_fmt','bgr0','-c:a','pcm_f32le',str(master.with_suffix('.part.mkv'))],check=True)
    master.with_suffix('.part.mkv').replace(master)
    # Verify actual decoded lossless pixels, not merely an encoder setting.
    actual = decoded_hashes(master,request['width'],request['height'],request['frames'])
    if actual != frame_hashes:
        index = next(i for i,(a,b) in enumerate(zip(actual,frame_hashes)) if a != b)
        raise ValueError('The lossless repair master changed decoded pixels at frame '+str(index))
    subprocess.run([*common,'-c:v','libx264','-threads','2','-crf','16','-preset','medium','-pix_fmt','yuv420p','-c:a','copy',
                    '-movflags','+faststart',str(preview.with_suffix('.part.mp4'))],check=True)
    preview.with_suffix('.part.mp4').replace(preview)
    for file in (master,preview):
        verify_clock(file,request)
    if audio_signature(preview) != audio_signature(folder/'finished.mp4'):
        raise ValueError('Repair preview altered original audio timestamps, packets or padding.')
    if audio_pcm(master) != audio_pcm(folder/'finished.mp4'):
        raise ValueError('Repair master altered the exact decoded original audio samples.')
    return {'id':candidate,'recipe':'inward-boundary-v1' if candidate == 'boundary' else 'identity80-v1',
            'preview':preview.name,'master':master.name,'previewSHA256':digest(preview),'masterSHA256':digest(master),
            'protectedFramesExact':True,'protectedPixelsExact':True,'losslessDecodedPixelsVerified':True,
            'audioPacketsExact':True,'masterAudioPCMExact':True,'mp4Recompressed':True}


def verify_records(receipt, request):
    """A checkpoint is a contiguous global prefix, never a renumbered patch."""
    if receipt.get('request') != request or not isinstance(receipt.get('records'),list) or len(receipt['records']) > request['frames']:
        raise ValueError('The repair checkpoint request or frame count changed.')
    ids = ['boundary','identity80'] if request['goal'] == 'auto' else ['boundary' if request['goal'] == 'boundary' else 'identity80']
    for index,row in enumerate(receipt['records']):
        if row.get('frame') != index or set(row.get('outputs',{})) != set(ids):
            raise ValueError('Repair checkpoints are not an exact ordered global prefix.')
        if row.get('weight') != temporal_weight(index,request['ranges']):
            raise ValueError('The saved visible repair handles changed.')
        for candidate in ids:
            output = row['outputs'][candidate]
            if output.get('protectedPixelsExact') is not True or type(output.get('changedPixels')) is not int or output['changedPixels'] < 0:
                raise ValueError('The saved repair protection receipt is invalid.')
    return ids


def assemble_offline(request, receipt, cache, output):
    """Finish verified downloaded selected PNGs using the local canonical parent.

    No source/raw model input, CUDA, model setup, SSH or running GPU is needed.
    Unchanged frames are decoded from the exact locally bound finished parent.
    """
    import copy
    import shutil
    validate_request(request)
    ids = verify_records(receipt,request)
    if receipt.get('canonicalDecoder') != CANONICAL_DECODER:
        raise ValueError('The checkpoint uses a different canonical parent decoder.')
    if len(receipt['records']) != request['frames']:
        raise ValueError('The selected frame checkpoint is incomplete; reconnect the same GPU to continue it.')
    finished = Path(request['inputs']['finished']).resolve()
    if digest(finished) != request['binding']['finishedSHA256']:
        raise ValueError('The local canonical parent changed; offline assembly did not start.')
    cache,output = Path(cache),Path(output)
    folder = output/'offline-assembly'
    folder.mkdir(exist_ok=True)
    target = folder/'finished.mp4'
    if target.exists():
        if digest(target) != request['binding']['finishedSHA256']:
            raise ValueError('Offline assembly belongs to another canonical parent.')
    else:
        try:
            os.link(finished,target)
        except OSError:
            shutil.copyfile(finished,target)
    hashes = {candidate:[] for candidate in ids}
    for candidate in ids:
        (folder/'result'/candidate).mkdir(parents=True,exist_ok=True)
    canonical_hashes = decoded_hashes(finished,request['width'],request['height'],request['frames'])
    canonical_frames = folder/'canonical'
    canonical_frames.mkdir(exist_ok=True)
    subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-threads','1','-flags','+bitexact','-i',str(finished),
                    '-map','0:v:0','-fps_mode','passthrough','-sws_flags','accurate_rnd+bitexact',
                    '-pix_fmt','rgb24','-threads','2',str(canonical_frames/'frame-%06d.png')],check=True)
    for index,row in enumerate(receipt['records']):
        if canonical_hashes[index] != row['parentDecodedSHA256']:
            raise ValueError('Local parent decoding differs from the saved repair frame clock.')
        for candidate in ids:
            data = row['outputs'][candidate]
            if data['changedPixels']:
                source = cache/candidate/f'frame-{index:06d}.png'
                if not source.is_file() or source.is_symlink() or digest(source) != data['sha256']:
                    raise ValueError('A corrected frame is missing or changed; reconnect to download its checkpoint.')
                decoded = decoded_hashes(source,request['width'],request['height'],1)[0]
            else:
                source = canonical_frames/f'frame-{index+1:06d}.png'
                decoded = canonical_hashes[index]
            if decoded != data['decodedSHA256']:
                raise ValueError('Downloaded repair pixels failed their global frame checksum.')
            if row['weight'] == 0 and decoded != canonical_hashes[index]:
                raise ValueError('A downloaded repair altered a protected full frame.')
            shutil.copyfile(source,folder/'result'/candidate/f'frame-{index:06d}.png')
            hashes[candidate].append(decoded)
    completed = copy.deepcopy(receipt)
    completed['candidates'] = []
    for candidate in ids:
        value = export_candidate(folder,request,candidate,hashes[candidate])
        changed = sum(row['outputs'][candidate]['changedPixels'] > 0 for row in completed['records'])
        value.update(changedFrames=changed,qualified=changed > 0,
                     warnings=candidate_warnings(completed,changed))
        for key in ('preview','master'):
            shutil.copyfile(folder/'result'/value[key],output/value[key])
        completed['candidates'].append(value)
    completed.update(complete=True,assemblyDevice='local-CPU',originalWorkerElapsedSeconds=receipt.get('elapsedSeconds',0),
                     assemblyFFmpegVersion=subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0])
    atomic(output/'receipt.json',completed)
    return completed


def process(folder):
    import cv2
    import numpy as np
    from face_performance import FaceModels
    from face_feature_cleanup import SemanticParser
    request = json.loads((folder/'request.json').read_text())
    infos, inherited = verify_inputs(folder, request)
    result = folder/'result'
    result.mkdir(exist_ok=True)
    receipt_file = result/'receipt.json'
    previous = json.loads(receipt_file.read_text()) if receipt_file.exists() else None
    if previous and previous['request'] != request:
        raise ValueError('Saved repair belongs to different frozen inputs.')
    if previous:
        verify_records(previous,request)
    if previous and previous.get('complete'):
        for row in previous['candidates']:
            if any(digest(result/row[k]) != row[k+'SHA256'] for k in ('preview','master')):
                raise ValueError('A saved repair candidate changed.')
        return previous
    selected = selected_frames(request['ranges'])
    if not selected:
        raise ValueError('The selection has no editable frames after its protected joins.')
    ids = ['boundary','identity80'] if request['goal'] == 'auto' else ['boundary' if request['goal'] == 'boundary' else 'identity80']
    receipt = previous or {'version':VERSION,'request':request,'complete':False,'profileSHA256':request['binding']['profileSHA256'],
        **{k:request[k] for k in ('frames','fps','width','height')},'parent':request['binding'],
        'inheritance':request['inheritance'],'records':[],'candidates':[], 'elapsedSeconds':0,
        'optionalEyeFinish':{'inherited':request['parent']['version']=='source-face-v8','recomputed':False,
                             'eyeInteriorsProtected':request['parent']['version']=='source-face-v8'},
        'qualityAcceptance':'user-comparison-required','sourceRGBTransferred':False}
    receipt['canonicalDecoder'] = CANONICAL_DECODER
    ffmpeg_version = subprocess.check_output(['ffmpeg','-version'],text=True).splitlines()[0]
    if previous and (previous.get('canonicalFFmpegVersion') != ffmpeg_version or previous.get('trackingOpenCVVersion') != cv2.__version__):
        raise ValueError('The saved repair decoder/tracking runtime changed. Existing frames were preserved.')
    receipt['canonicalFFmpegVersion'] = ffmpeg_version
    receipt['trackingOpenCVVersion'] = cv2.__version__
    atomic(receipt_file, receipt)
    for candidate in ids:
        (result/candidate).mkdir(exist_ok=True)
    (result/'layers').mkdir(exist_ok=True)
    existing = {row['frame']:row for row in receipt['records']}
    pending = set(selected)-set(existing)
    observed = correction = parser = None
    if pending:
        initialize()
        from facefusion.face_recognizer import calculate_face_embedding
        # Tracking's target is the canonical finished parent; SAM is freed
        # before face models initialize. Raw motion stays a separate input.
        observed = tracking(folder,request,infos['finished'])
        receipt['tracking'] = {'receiptSHA256':digest(observed.receipt_path),'target':'finished-parent',
                               'recomputedForRepair':True}
        reference = cv2.imread(str(folder/'reference.png'))
        found = face(reference)
        if found is None:
            raise ValueError('The saved donor no longer resolves to one clear face; no alternate donor was chosen.')
        _, embedding = calculate_face_embedding(reference,found[1])
        model = FaceModels(MODEL_ROOT,embedding)
        parser = SemanticParser(MODEL_ROOT)
        captured, correction = corrector(model,parser,inherited)
        receipt['providers'] = {k:s.get_providers() for k,s in model.sessions.items()}
        receipt['providers']['parser'] = parser.session.get_providers()
        receipt['onnxruntime'] = model.ort.__version__
    captures = {role:cv2.VideoCapture(str(folder/(role+'.mp4'))) for role in ('raw','source','finished')}
    hashes = {candidate:[] for candidate in ids}
    selected_set = set(selected)
    elapsed, started = receipt['elapsedSeconds'], time.monotonic()
    canonical_decoder = decoded_frames(folder/'finished.mp4',request['width'],request['height'],request['frames'])
    try:
        for index in range(request['frames']):
            cancelled(folder)
            images = {}
            for role,capture in captures.items():
                ok,image = capture.read()
                if not ok:
                    raise ValueError('A frozen repair input ended early.')
                images[role] = image
            canonical = np.frombuffer(next(canonical_decoder),np.uint8).reshape(request['height'],request['width'],3).copy()
            canonical_sha = hashlib.sha256(canonical.tobytes()).hexdigest()
            if index in existing:
                row = existing[index]
                if row['parentDecodedSHA256'] != canonical_sha:
                    raise ValueError('Canonical decoded pixels changed during repair recovery.')
                for candidate in ids:
                    file = result/candidate/f'frame-{index:06d}.png'
                    if digest(file) != row['outputs'][candidate]['sha256']:
                        raise ValueError('A checkpointed repair frame changed.')
                    hashes[candidate].append(row['outputs'][candidate]['decodedSHA256'])
                if row.get('layersSHA256') and digest(result/'layers'/f'{index:06d}.npz') != row['layersSHA256']:
                    raise ValueError('A saved selected-frame prediction layer changed.')
                continue
            row = {'frame':index,'parentDecodedSHA256':canonical_sha,
                   'parentTrackingDecodedSHA256':hashlib.sha256(images['finished'].tobytes()).hexdigest(),
                   'outputs':{},'weight':temporal_weight(index,request['ranges'])}
            layers, reason = None, 'outside-editable-range'
            observation = None
            if index in selected_set:
                observation = observed.frame(index)
                source = images['source']
                if source.shape != canonical.shape:
                    source = cv2.resize(source,(request['width'],request['height']),interpolation=cv2.INTER_AREA)
                if hashlib.sha256(source.tobytes()).hexdigest() != observation['sourceDecodedSHA256'] or row['parentTrackingDecodedSHA256'] != observation['targetDecodedSHA256']:
                    raise ValueError('Foreground analysis belongs to different decoded source or parent pixels.')
                layers,reason = frame_layers(images['raw'],source,canonical,observation,correction,parser,request['parent']['version']=='source-face-v8')
                if layers is not None:
                    layer_file = result/'layers'/f'{index:06d}.npz'
                    np.savez_compressed(layer_file,**{k:v for k,v in layers.items() if isinstance(v,np.ndarray)})
                    row['layersSHA256'] = digest(layer_file)
                    row['matrix'] = layers['matrix'].tolist()
            row['reason'] = reason
            for candidate in ids:
                output = canonical.copy()
                permission = np.zeros(canonical.shape[:2],np.float32)
                if layers is not None:
                    prediction,allowed = project_layer(layers[candidate],layers[candidate+'Alpha'],layers['matrix'],(request['width'],request['height']))
                    output,permission = composite_layer(canonical,prediction,allowed,observation['targetVeto'],row['weight'])
                    hard = np.asarray(observation['targetHard'],bool)
                    if not np.array_equal(output[hard],canonical[hard]):
                        raise ValueError('Repair changed a tracked canonical foreground hand.')
                if not np.array_equal(output[permission == 0],canonical[permission == 0]):
                    raise ValueError('Repair changed a protected canonical scene pixel.')
                file = result/candidate/f'frame-{index:06d}.png'
                png(file,output)
                pixel_sha = hashlib.sha256(output.tobytes()).hexdigest()
                hashes[candidate].append(pixel_sha)
                row['outputs'][candidate] = {'sha256':digest(file),'decodedSHA256':pixel_sha,
                    'changedPixels':int(np.any(output != canonical,axis=2).sum()),'protectedPixelsExact':True,
                    'editablePixels':int((permission > 0).sum())}
            receipt['records'].append(row)
            receipt['elapsedSeconds'] = elapsed+time.monotonic()-started
            atomic(receipt_file,receipt)
            progress(folder,index+1,request['frames'],'Repairing selected facial frames' if index in selected_set else 'Preserving accepted frames')
        if any(c.read()[0] for c in captures.values()):
            raise ValueError('A frozen repair input produced unexpected trailing frames.')
        if next(canonical_decoder,None) is not None:
            raise ValueError('The canonical parent decoder produced unexpected extra frames.')
    finally:
        canonical_decoder.close()
        for capture in captures.values():
            capture.release()
    receipt['candidates'] = []
    for candidate in ids:
        cancelled(folder)
        progress(folder,request['frames'],request['frames']+1,'Verifying lossless repair and original audio')
        value = export_candidate(folder,request,candidate,hashes[candidate])
        changed = sum(row['outputs'][candidate]['changedPixels'] > 0 for row in receipt['records'])
        value.update(changedFrames=changed,qualified=changed > 0,
                     warnings=candidate_warnings(receipt,changed))
        receipt['candidates'].append(value)
    receipt.update(complete=True,elapsedSeconds=elapsed+time.monotonic()-started)
    atomic(receipt_file,receipt)
    progress(folder,request['frames']+1,request['frames']+1,'Face repair ready for comparison')
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action',choices=['launch','poll','cancel','worker'])
    parser.add_argument('--job',required=True)
    args = parser.parse_args()
    folder = ROOT/'jobs'/str(uuid.UUID(args.job))
    if not folder.is_dir() or folder.is_symlink():
        raise ValueError('The owned repair request has not been prepared.')
    if args.action == 'cancel':
        (folder/'result').mkdir(exist_ok=True)
        (folder/'result/CANCEL').touch()
        value = {'running':running(folder)}
    elif args.action == 'poll':
        value = json.loads((folder/'worker.json').read_text()) if (folder/'worker.json').exists() else {'state':'starting'}
        value['running'] = running(folder)
        if (folder/'result/progress.json').exists():
            value.update(json.loads((folder/'result/progress.json').read_text()))
        if not value['running'] and value['state'] not in ('completed','interrupted'):
            value.update(state='interrupted',error='The repair worker stopped; its verified frames remain on this instance.')
    elif args.action == 'launch':
        with (folder/'launch.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            if not running(folder):
                idle()
                request = json.loads((folder/'request.json').read_text())
                verify_inputs(folder,request)
                for version in {request['parent']['version'],'source-face-v11'}:
                    if not inspect(verify=True,version=version)['ready']:
                        raise ValueError('Prepare the selected facial and tracking tools first. Repair never downloads weights.')
                reserve = 5*1024**3+request['width']*request['height']*request['frames']*3*4
                if __import__('shutil').disk_usage(folder).free < reserve:
                    raise ValueError('Free more disk space for lossless repair candidates. The parent remains unchanged.')
                (folder/'result').mkdir(exist_ok=True)
                (folder/'result/CANCEL').unlink(missing_ok=True)
                (folder/'worker.json').unlink(missing_ok=True)
                with (folder/'worker.log').open('ab') as log:
                    child = subprocess.Popen([str(paths()[1]),'-u',str(Path(__file__).resolve()),'worker','--job',args.job],
                        stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
                atomic(folder/'pid.json',{'pid':child.pid})
        value = {'launched':True}
    else:
        idle()
        with (ROOT/'state/processing.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            try:
                atomic(folder/'worker.json',{'state':'running'})
                process(folder)
                atomic(folder/'worker.json',{'state':'completed'})
            except BaseException as error:
                atomic(folder/'worker.json',{'state':'interrupted','error':str(error)[-1200:]})
                raise
        return
    print('RECAST_FACE_REPAIR '+json.dumps(value),flush=True)


if __name__ == '__main__':
    try:
        main()
    except (ValueError,OSError,subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
