"""Versioned optional eye finish; native facial frames and all inputs remain immutable."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

from facial_runtime import ROOT, MODEL_ROOT, digest, eye_python, profile_hash


def atomic(file, value):
    temporary = file.with_suffix('.tmp.json')
    temporary.write_text(json.dumps(value)+'\n')
    temporary.replace(file)


def settings():
    return json.loads((ROOT / 'config/facial-consistency-eye-finish.lock.json').read_text())


def check_cancel(folder):
    if (folder / 'result/CANCEL').exists():
        raise ValueError('Optional eye finishing cancelled; native and completed eye frames were kept.')
    from facial_worker import idle
    idle()


class EyeRestorer:
    """Same tested FFHQ/CodeFormer and eye-interior permission; no implicit download."""
    def __init__(self, model_root=MODEL_ROOT, device='cuda'):
        import onnxruntime as ort
        self.config = settings()
        self.options = ort.SessionOptions()
        self.options.intra_op_num_threads, self.options.inter_op_num_threads, self.options.log_severity_level = 2, 1, 3
        self.providers = ['CUDAExecutionProvider', 'CPUExecutionProvider'] if device == 'cuda' else ['CPUExecutionProvider']
        self.sessions = {}
        for key, relative in [('enhancer', 'eye_finish/codeformer.onnx'), ('parser', 'facefusion/bisenet_resnet_34.onnx')]:
            session = ort.InferenceSession(str(Path(model_root)/relative), sess_options=self.options, providers=self.providers)
            if session.get_providers()[0] != self.providers[0]:
                raise ValueError('The selected eye-finishing device did not initialize; no fallback was started.')
            session.disable_fallback()
            self.sessions[key] = session
        if {i.name for i in self.sessions['enhancer'].get_inputs()} != {'input', 'weight'}:
            raise ValueError('The installed eye restorer has an unexpected interface.')

    def parse(self, image):
        import numpy as np
        tensor = image[:, :, ::-1].astype(np.float32)/255
        tensor = (tensor-np.array([.485,.456,.406],np.float32))/np.array([.229,.224,.225],np.float32)
        tensor = np.ascontiguousarray(tensor.transpose(2,0,1)[None])
        session = self.sessions['parser']
        value = session.run(None,{session.get_inputs()[0].name:tensor})[0]
        if value.shape != (1,19,512,512) or not np.isfinite(value).all():
            raise ValueError('The eye restorer returned invalid region masks.')
        return value[0].argmax(0).astype(np.uint8)

    def __call__(self, current, gates):
        import cv2
        import numpy as np
        from facial_worker import face
        from face_feature_cleanup import smooth
        from facefusion.face_helper import warp_face_by_face_landmark_5
        from facefusion.face_masker import create_occlusion_mask
        found = face(current)
        if found is None:
            return current.copy(), np.zeros((512,512),np.float32), {'action':'preserved','reason':'restoration-face-uncertain'}
        crop, matrix = warp_face_by_face_landmark_5(current,found[1],'ffhq_512',(512,512))
        tensor = np.ascontiguousarray(((crop[:,:,::-1].astype(np.float32)/255-.5)/.5).transpose(2,0,1)[None])
        start = time.monotonic()
        value = self.sessions['enhancer'].run(None,{'input':tensor,'weight':np.array([self.config['restoration_fidelity']],np.float64)})[0][0]
        seconds = time.monotonic()-start
        if value.shape != (3,512,512) or not np.isfinite(value).all():
            raise ValueError('The eye restorer returned invalid image pixels.')
        restored = np.rint((np.clip(value,-1,1).transpose(1,2,0)+1)/2*255).clip(0,255).astype(np.uint8)[:,:,::-1]
        enhanced = cv2.warpAffine(restored,cv2.invertAffineTransform(matrix),(512,512))
        labels = self.parse(current)
        alpha = smooth(cv2.distanceTransform(np.isin(labels,[4,5]).astype(np.uint8),cv2.DIST_L2,5)/3)
        alpha[:,:256] *= gates[0]
        alpha[:,256:] *= gates[1]
        alpha = np.minimum(alpha,create_occlusion_mask(current).clip(0,1))
        permission = alpha*self.config['restoration_blend']
        result = np.rint(enhanced.astype(np.float32)*permission[...,None]+current*(1-permission[...,None])).clip(0,255).astype(np.uint8)
        if not np.array_equal(result[alpha == 0],current[alpha == 0]):
            raise ValueError('Eye restoration changed protected crop pixels.')
        return result,alpha,{'action':'eye-only-restoration','modelSeconds':seconds,'restorationMatrix':matrix.tolist(),
                            'sourceEyeGates':gates,'fidelityWeight':self.config['restoration_fidelity']}


def preflight_eye_tools():
    restorer = EyeRestorer()
    subprocess.run([str(eye_python()),str(ROOT/'scripts/face_eye_motion.py'),'--check',str(MODEL_ROOT/'eye_finish/face_landmarker.task')],check=True)
    return restorer


def frozen_native(folder, native_process, verify_frames=True):
    """The v4 compositor math runs on the v5-bound request, once, before eye finishing."""
    result = folder/'result'
    native_file = result/'native-receipt.json'
    request = json.loads((folder/'request.json').read_text())
    inputs = json.loads((folder/'inputs.json').read_text())
    if request.get('version') != 'source-face-v5' or request['profileSHA256'] != profile_hash('source-face-v5'):
        raise ValueError('The saved optional eye recipe differs from the installed tools.')
    if native_file.exists():
        native = json.loads(native_file.read_text())
    else:
        native = native_process(folder)
        if not native['complete']:
            raise ValueError('The native facial base is incomplete.')
        final = result/'final.mp4'
        preserved = result/'native-final.mp4'
        if preserved.exists():
            if digest(preserved) != native['outputSHA256']:
                raise ValueError('A preserved native facial output differs; it was kept.')
        else:
            os.link(final,preserved)
        atomic(native_file,native)
    if not native.get('complete') or native['inputs'] != {**inputs,'version':'source-face-v5'} or inputs['request'] != request:
        raise ValueError('The frozen native facial inputs or settings changed.')
    if digest(result/'native-final.mp4') != native['outputSHA256']:
        raise ValueError('The preserved native facial output changed.')
    if verify_frames:
        for index, record in enumerate(native['records']):
            if record['frame'] != index or digest(result/f'frame-{index:06d}.png') != record['sha256']:
                raise ValueError('A preserved native facial frame changed.')
    return native


def finish(folder, native_process):
    import cv2
    import numpy as np
    result = folder/'result'
    prior_file = result/'receipt.json'
    prior = json.loads(prior_file.read_text()) if prior_file.exists() else {}
    native = frozen_native(folder,native_process,verify_frames=not prior.get('eyeFinish',{}).get('complete'))
    destination = result/'eye-finish'
    destination.mkdir(exist_ok=True)
    manifest = json.loads((ROOT/'config/facial-consistency-eye-finish-models.lock.json').read_text())
    bound = {'profileSHA256':profile_hash('source-face-v5'),'nativeReceiptSHA256':digest(result/'native-receipt.json'),
             'restorationModelSHA256':manifest['files'][0]['sha256'],'observationModelSHA256':manifest['files'][1]['sha256']}
    request_file = destination/'request.json'
    if request_file.exists():
        if json.loads(request_file.read_text()) != bound:
            raise ValueError('Saved eye-finishing inputs changed; existing frames were retained.')
    else:
        atomic(request_file,bound)
    final_receipt = json.loads((result/'receipt.json').read_text())
    if final_receipt.get('eyeFinish',{}).get('complete'):
        if final_receipt['eyeFinish']['requestSHA256'] != digest(request_file) or digest(result/'final.mp4') != final_receipt['outputSHA256']:
            raise ValueError('The completed eye result failed verification.')
        return final_receipt
    info = native['inputs']['target']
    count = info['frames']
    restoration_file = destination/'restoration.json'
    restoration = json.loads(restoration_file.read_text()) if restoration_file.exists() else {'inputs':bound,'complete':False,'records':[],'elapsedSeconds':0}
    if restoration['inputs'] != bound:
        raise ValueError('Saved eye restoration belongs to changed inputs.')
    restore_complete = restoration['complete']
    restorer = None if restore_complete else EyeRestorer()
    if restorer:
        restoration['providers'] = {key:s.get_providers()for key,s in restorer.sessions.items()}
    output = destination/'restored'
    output.mkdir(exist_ok=True)
    start = time.monotonic()
    elapsed = restoration['elapsedSeconds']
    for index, record in enumerate(native['records']):
        check_cancel(folder)
        file = output/f'frame-{index:06d}.png'
        if index < len(restoration['records']):
            prior = restoration['records'][index]
            if prior['frame'] != index or digest(file) != prior['sha256']:
                raise ValueError('A saved restored eye frame changed.')
            continue
        frame = cv2.imread(str(result/f'frame-{index:06d}.png'))
        edited = frame.copy()
        status = {'action':'preserved','reason':'base-face-uncertain'}
        gates = record.get('cleanup',{}).get('sourceEyeGates',[0,0])
        permitted = 0
        if record['action'] == 'refined' and any(g>0 for g in gates):
            restorer = restorer or EyeRestorer()
            matrix = np.asarray(record['matrix'],np.float32)
            current = cv2.warpAffine(frame,matrix,(512,512))
            corrected,permission,status = restorer(current,gates)
            inverse = cv2.invertAffineTransform(matrix)
            hard = cv2.warpAffine((permission>0).astype(np.float32),inverse,(info['width'],info['height']),flags=cv2.INTER_NEAREST)
            residual = cv2.warpAffine((corrected.astype(np.float32)-current)*(permission>0)[...,None],inverse,(info['width'],info['height']))*hard[...,None]
            edited = np.rint(frame.astype(np.float32)+residual).clip(0,255).astype(np.uint8)
            if not np.array_equal(edited[hard == 0],frame[hard == 0]):
                raise ValueError('Eye restoration changed protected scene pixels.')
            permitted = int((hard>0).sum())
        temporary = file.with_name(file.stem+'.tmp.png')
        if not cv2.imwrite(str(temporary),edited):
            raise ValueError('A restored eye frame could not be saved.')
        temporary.replace(file)
        restoration['records'].append({'frame':index,'sha256':digest(file),'nativeSHA256':record['sha256'],
                                       'changedPixels':int(np.any(edited != frame,axis=2).sum()),'permittedPixels':permitted,
                                       'protectedPixelsExact':True,'restoration':status})
        restoration['elapsedSeconds'] = elapsed+time.monotonic()-start
        if restorer:
            restoration['providers'] = {key:s.get_providers()for key,s in restorer.sessions.items()}
        atomic(restoration_file,restoration)
        atomic(destination/'progress.json',{'completed':count+index+1,'total':4*count,'phase':'Restoring visible eye detail','phaseFrame':index+1,'phaseFrames':count})
    if not restore_complete:
        restoration.update(complete=True,elapsedSeconds=elapsed+time.monotonic()-start)
        atomic(restoration_file,restoration)
    # Release the optional model before the separate CPU observer and encoder.
    del restorer
    check_cancel(folder)
    command = [str(eye_python()),'-u',str(ROOT/'scripts/face_eye_motion.py'),str(folder),'--parent',str(os.getpid())]
    child = subprocess.Popen(command)
    try:
        while child.poll() is None:
            check_cancel(folder)
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                continue
        if child.returncode:
            raise subprocess.CalledProcessError(child.returncode,command)
    except BaseException:
        (result/'CANCEL').touch()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.terminate()
            child.wait(timeout=10)
        raise
    placement = json.loads((destination/'placement.json').read_text())
    observations = json.loads((destination/'observations.json').read_text())
    if not placement['complete'] or len(placement['records']) != count or not observations['complete']:
        raise ValueError('The eye-position pass is incomplete; its native input was retained.')
    records = []
    for index, row in enumerate(placement['records']):
        check_cancel(folder)
        file = destination/'frames'/f'frame-{index:06d}.png'
        if row['frame'] != index or digest(file) != row['sha256']:
            raise ValueError('A completed eye-position frame changed before export.')
        record = copy.deepcopy(native['records'][index])
        record.update(nativeSHA256=record['sha256'],sha256=row['sha256'],eyeFinish={'restoration':restoration['records'][index],
                                                                               'placement':row['placement'],'placementChangedPixels':row['changedPixels']})
        records.append(record)
    from facial_worker import video_info
    check_cancel(folder)
    encode_start = time.monotonic()
    partial = destination/'final.part.mp4'
    subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-framerate',info['fps'],'-i',str(destination/'frames/frame-%06d.png'),
                    '-i',str(folder/'target.mp4'),'-map','0:v:0','-map','1:a?','-frames:v',str(count),'-c:v','libx264',
                    '-crf','16','-preset','medium','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(partial)],check=True)
    if video_info(partial) != info:
        raise ValueError('Eye-finishing export timing changed; saved frames were retained.')
    partial.replace(destination/'final.mp4')
    completed = copy.deepcopy(native)
    completed.update(records=records,outputSHA256=digest(destination/'final.mp4'),
                     elapsedSeconds=native['elapsedSeconds']+restoration['elapsedSeconds']+observations['elapsedSeconds']+placement['elapsedSeconds']+time.monotonic()-encode_start,
                     eyeFinish={'complete':True,'version':'source-eye-finish-v1','requestSHA256':digest(request_file),
                                'nativeReceiptSHA256':bound['nativeReceiptSHA256'],'nativeOutputSHA256':native['outputSHA256'],
                                'restorationModelSHA256':bound['restorationModelSHA256'],'observationModelSHA256':bound['observationModelSHA256'],
                                'restorationReceiptSHA256':digest(restoration_file),'observationReceiptSHA256':digest(destination/'observations.json'),
                                'placementReceiptSHA256':digest(destination/'placement.json'),'restorationSeconds':restoration['elapsedSeconds'],
                                'observationSeconds':observations['elapsedSeconds'],'placementSeconds':placement['elapsedSeconds'],
                                'restorationFrames':sum(r['changedPixels']>0 for r in restoration['records']),
                                'placementFrames':sum(r['changedPixels']>0 for r in placement['records']),
                                'observerDevice':'CPU on the same managed GPU host','sourceRGBTransferred':False})
    completed['providers']['eyeEnhancer'] = restoration.get('providers',{}).get('enhancer',[])
    completed['providers']['eyeParser'] = restoration.get('providers',{}).get('parser',[])
    check_cancel(folder)
    temporary = result/'final.eye.tmp.mp4'
    shutil.copyfile(destination/'final.mp4',temporary)
    temporary.replace(result/'final.mp4')
    atomic(result/'receipt.json',completed)
    atomic(destination/'progress.json',{'completed':4*count,'total':4*count,'phase':'Saving finished eyes','phaseFrame':count,'phaseFrames':count})
    return completed
