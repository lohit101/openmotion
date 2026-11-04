"""Selective repair protects accepted footage, explicit joins and provenance."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import ModuleType
import contextlib
import io

import cv2
import numpy as np

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from face_repair import (validate_ranges, temporal_weight, selected_frames,
                         composite_layer, validate_request, fingerprint)
from facial_runtime import profile_hash


class RepairRangeTests(unittest.TestCase):
    def setUp(self):
        self.ranges = [dict(startFrame=55,endFrame=79,editableStartFrame=49,editableEndFrame=85),
                       dict(startFrame=110,endFrame=134,editableStartFrame=104,editableEndFrame=140)]

    def test_displayed_half_open_ranges_and_outer_join_frames(self):
        validate_ranges(self.ranges,240)
        chosen = selected_frames(self.ranges)
        self.assertEqual((chosen[0],chosen[-1]),(50,138))
        for i in (0,48,49,84,85,103,104,139,140,239):
            self.assertEqual(temporal_weight(i,self.ranges),0)
        for i in (55,78,110,133):
            self.assertEqual(temporal_weight(i,self.ranges),1)
        self.assertTrue(all(temporal_weight(i,self.ranges) < temporal_weight(i+1,self.ranges) for i in range(49,55)))

    def test_overlapping_handles_take_maximum_without_duplicated_work(self):
        ranges = [dict(startFrame=10,endFrame=15,editableStartFrame=4,editableEndFrame=21),
                  dict(startFrame=18,endFrame=23,editableStartFrame=12,editableEndFrame=29)]
        validate_ranges(ranges,40)
        chosen = selected_frames(ranges)
        self.assertEqual(len(chosen),len(set(chosen)))
        for i in range(40):
            self.assertEqual(temporal_weight(i,ranges),max(temporal_weight(i,[r]) for r in ranges))

    def test_clip_edges_and_one_frame_selection_are_not_lost(self):
        for frame in (0,9):
            r = [dict(startFrame=frame,endFrame=frame+1,editableStartFrame=frame,editableEndFrame=frame+1)]
            validate_ranges(r,10)
            self.assertEqual(selected_frames(r),[frame])
            self.assertEqual(temporal_weight(frame,r),1)

    def test_bad_ranges_and_non_24fps_are_rejected(self):
        cases = [[],[dict(startFrame=10,endFrame=10,editableStartFrame=4,editableEndFrame=16)],
                 [dict(startFrame=10,endFrame=20,editableStartFrame=3,editableEndFrame=26)],
                 [dict(startFrame=10,endFrame=20,editableStartFrame=4,editableEndFrame=27)],
                 [dict(startFrame=True,endFrame=20,editableStartFrame=0,editableEndFrame=26)],
                 [dict(startFrame=10,endFrame=20,editableStartFrame=4,editableEndFrame=26),
                  dict(startFrame=19,endFrame=30,editableStartFrame=13,editableEndFrame=36)]]
        for value in cases:
            with self.subTest(value=value),self.assertRaises(ValueError):
                validate_ranges(value,40)
        with self.assertRaises(ValueError):
            validate_ranges(self.ranges,240,30)


class RepairCompositeTests(unittest.TestCase):
    def test_canonical_finished_scene_is_the_only_background(self):
        rng = np.random.default_rng(44)
        finished = rng.integers(0,256,(64,64,3),dtype=np.uint8)
        prediction = np.full(finished.shape,213,np.float32)
        permission = np.zeros((64,64),np.float32)
        permission[20:44,20:44] = 1
        veto = np.zeros_like(permission)
        veto[30:40,:] = 1
        output,alpha = composite_layer(finished,prediction,permission,veto,1)
        np.testing.assert_array_equal(output[alpha == 0],finished[alpha == 0])
        np.testing.assert_array_equal(output[30:40],finished[30:40])
        self.assertGreater(np.any(output != finished,axis=2).sum(),0)

    def test_zero_handle_is_exact_and_fractional_veto_is_final(self):
        parent = np.full((64,64,3),100,np.uint8)
        prediction = np.full(parent.shape,200,np.float32)
        full = np.ones((64,64),np.float32)
        actual,alpha = composite_layer(parent,prediction,full,np.zeros_like(full),0)
        np.testing.assert_array_equal(actual,parent)
        actual,alpha = composite_layer(parent,prediction,full,np.full_like(full,.5),.5)
        np.testing.assert_array_equal(actual,125)
        self.assertTrue(np.all(alpha == .25))

    def test_invalid_permission_and_geometry_fail_before_writing(self):
        image = np.zeros((64,64,3),np.uint8)
        mask = np.zeros((64,64),np.float32)
        for permission,veto,weight in [(mask+np.nan,mask,1),(mask,mask+2,1),(mask,mask,-1)]:
            with self.assertRaises(ValueError):
                composite_layer(image,image,permission,veto,weight)


class RepairBindingTests(unittest.TestCase):
    def request(self):
        root = '00000000-0000-0000-0000-000000000001'
        return {'version':'face-repair-v1','jobId':'00000000-0000-0000-0000-000000000002',
            'parentJobId':root,'rootJobId':root,'goal':'auto','frames':24,'fps':24,'width':64,'height':64,
            'ranges':[dict(startFrame=5,endFrame=10,editableStartFrame=0,editableEndFrame=16)],
            'parent':{'version':'source-face-v8','profile':'perform-onnx60','anchorFrame':0},
            'binding':{**{k:'a'*64 for k in ('finishedSHA256','rawSHA256','sourceSHA256','referenceSHA256','parentReceiptSHA256','parentCalibrationSHA256')},
                'parentProfileSHA256':profile_hash('source-face-v8'),'profileSHA256':fingerprint('source-face-v8')},
            'inheritance':{'parentJobId':root,'parentReceiptSHA256':'a'*64,'parentCalibrationSHA256':'a'*64}}

    def test_calibration_keeps_actual_root_owner_on_revision_of_revision(self):
        request = self.request()
        request['parentJobId'] = '00000000-0000-0000-0000-000000000003'
        self.assertEqual(validate_request(request),request)
        request['inheritance']['parentJobId'] = request['parentJobId']
        with self.assertRaises(ValueError):
            validate_request(request)
        request = self.request()
        request['parentJobId'] = '00000000-0000-0000-0000-000000000003'
        request['jobId'] = request['rootJobId']
        with self.assertRaises(ValueError):
            validate_request(request)

    def test_wrong_profile_future_goal_and_tampered_binding_are_rejected(self):
        for key,value in [('goal','eyes'),('jobId',self.request()['parentJobId'])]:
            request = self.request()
            request[key] = value
            with self.assertRaises(ValueError):
                validate_request(request)
        request = self.request()
        request['binding']['parentProfileSHA256'] = '0'*64
        with self.assertRaises(ValueError):
            validate_request(request)


class RepairLayerTests(unittest.TestCase):
    def test_single_raw_inference_serves_two_candidates_without_repainting_parent_eyes(self):
        from face_repair_worker import frame_layers
        helper = ModuleType('facefusion.face_helper')
        helper.warp_face_by_face_landmark_5 = lambda image,*args:(image.copy(),np.array([[1.,0,0],[0,1.,0]],np.float32))
        masker = ModuleType('facefusion.face_masker')
        masker.create_occlusion_mask = lambda crop:np.ones((512,512),np.float32)
        five = np.array([[200,200],[300,200],[250,250],[215,300],[285,300]],np.float32)
        detected = (np.array([100,100,410,410]),five,np.zeros((68,2),np.float32))
        labels = np.zeros((512,512),np.uint8)
        labels[80:440,90:420] = 1
        labels[190:215,185:220] = 4
        labels[190:215,285:320] = 5
        class Models:
            def __init__(self):
                self.calls = 0
                self.expression = np.full((512,512,3),100,np.uint8)
                self.swapped = np.full((512,512,3),200,np.uint8)
            def correct(self,driver,target,permission,regional):
                self.calls += 1
                np.testing.assert_array_equal(driver,70)
                np.testing.assert_array_equal(target,10)
                return np.full((512,512,3),160,np.uint8)
        model = Models()
        with patch.dict(sys.modules,{'facefusion.face_helper':helper,'facefusion.face_masker':masker}), \
             patch('face_repair_worker.face',return_value=detected), \
             patch('face_feature_cleanup.source_eye_gates',return_value=[1,1]), \
             patch('face_feature_cleanup.restore_eye_detail',side_effect=lambda raw,edited,*args:(edited,{})), \
             patch('face_jaw_geometry.jaw_masks',return_value=(np.ones((512,512),np.float32),np.ones((512,512),np.float32),{'supportPixels':0})):
            layers,reason = frame_layers(np.full((512,512,3),10,np.uint8),np.full((512,512,3),70,np.uint8),
                np.full((512,512,3),30,np.uint8),{'sourceFace':detected,'targetFace':detected,'targetMaskState':'known-none'},
                model,lambda image:labels.copy(),True)
        self.assertIsNone(reason)
        self.assertEqual(model.calls,1)
        self.assertTrue(np.all(layers['identity80Alpha'][labels == 4] == 0))
        self.assertTrue(np.all(layers['identity80Alpha'][labels == 5] == 0))
        self.assertTrue(np.all(layers['identity80Alpha'][labels == 0] == 0))
        np.testing.assert_array_equal(layers['rawCrop'],10)
        np.testing.assert_array_equal(layers['parentCrop'],30)
        np.testing.assert_array_equal(layers['expression'],100)
        np.testing.assert_array_equal(layers['identity'],200)


class RepairTransportTests(unittest.TestCase):
    def test_preparation_progress_is_immediate_and_never_claims_refined_faces(self):
        from managed_face_repair import progress
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            progress({'frames':240},'Checking installed face repair tools')
        line = output.getvalue().strip()
        self.assertTrue(line.startswith('RECAST_FACE_REPAIR_PROGRESS '))
        value = json.loads(line.split(' ',1)[1])
        self.assertEqual(value,{'frame':0,'frames':240,'stage':'Checking installed face repair tools','phase':'preparation'})

    def test_lost_launch_response_keeps_running_or_unknown_worker_protected(self):
        from managed_face_repair import launch
        rejected = subprocess.CalledProcessError(255,['private-ssh-argv'])
        for observed in ({'running':True},OSError('unreachable')):
            output = io.StringIO()
            with patch('managed_face_repair.call',side_effect=[rejected,observed]),contextlib.redirect_stdout(output):
                with self.assertRaises(subprocess.CalledProcessError):
                    launch({},'job')
            self.assertNotIn('STOPPED',output.getvalue())

    def test_rejected_launch_clears_handle_only_after_exact_stopped_pid(self):
        from managed_face_repair import launch
        rejected = subprocess.CalledProcessError(1,['private-ssh-argv'])
        output = io.StringIO()
        with patch('managed_face_repair.call',side_effect=[rejected,{'running':False}]),contextlib.redirect_stdout(output):
            with self.assertRaises(subprocess.CalledProcessError):
                launch({},'job')
        self.assertEqual(output.getvalue().strip(),'RECAST_FACE_REPAIR_STOPPED')


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'),'ffmpeg required')
class RepairExportTests(unittest.TestCase):
    def test_real_lossless_rgb_audio_padding_and_absolute_frame_clock(self):
        from face_repair_worker import export_candidate, audio_signature, audio_pcm
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=64x64:rate=24:duration=0.5',
                '-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=0.5','-c:v','libx264','-pix_fmt','yuv420p',
                '-c:a','aac','-shortest',str(folder/'finished.mp4')],check=True)
            frames = folder/'result/boundary'
            frames.mkdir(parents=True)
            capture = cv2.VideoCapture(str(folder/'finished.mp4'))
            hashes = []
            i = 0
            while True:
                ok,image = capture.read()
                if not ok:
                    break
                if 4 <= i < 7:
                    image[20:30,20:30] = 128
                self.assertTrue(cv2.imwrite(str(frames/f'frame-{i:06d}.png'),image))
                hashes.append(hashlib.sha256(image.tobytes()).hexdigest())
                i += 1
            capture.release()
            result = export_candidate(folder,{'frames':12,'fps':24,'width':64,'height':64},'boundary',hashes)
            self.assertTrue(result['losslessDecodedPixelsVerified'])
            self.assertTrue(result['masterAudioPCMExact'])
            self.assertEqual(audio_signature(folder/'finished.mp4'),audio_signature(folder/'result/candidate-boundary.mp4'))
            self.assertEqual(audio_pcm(folder/'finished.mp4'),audio_pcm(folder/'result/candidate-boundary.mkv'))

    def test_offline_selected_png_assembly_needs_no_model_runtime(self):
        from face_repair_worker import assemble_offline,decoded_frames,CANONICAL_DECODER
        from facial_runtime import digest
        from managed_face_repair import try_offline
        from face_repair import canonical_hash
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            parent = folder/'parent.mp4'
            subprocess.run(['ffmpeg','-v','error','-nostdin','-y','-f','lavfi','-i','testsrc2=size=64x64:rate=24:duration=0.5',
                            '-c:v','libx264','-pix_fmt','yuv420p',str(parent)],check=True)
            request = RepairBindingTests().request()
            request.update(frames=12,goal='boundary',instanceId=1,inputs={'finished':str(parent)})
            request['ranges'] = [dict(startFrame=4,endFrame=7,editableStartFrame=0,editableEndFrame=10)]
            request['binding']['finishedSHA256'] = digest(parent)
            output = folder/'output'
            cache = output/'frames/boundary'
            cache.mkdir(parents=True)
            rows = []
            for index,pixels in enumerate(decoded_frames(parent,64,64,12)):
                image = np.frombuffer(pixels,np.uint8).reshape(64,64,3).copy()
                parent_hash = hashlib.sha256(image.tobytes()).hexdigest()
                if index == 5:
                    image[20:30,20:30] = 211
                file = cache/f'frame-{index:06d}.png'
                cv2.imwrite(str(file),image)
                data = {'sha256':digest(file),'decodedSHA256':hashlib.sha256(image.tobytes()).hexdigest(),
                        'protectedPixelsExact':True,'changedPixels':100 if index == 5 else 0,'editablePixels':100 if index == 5 else 0}
                rows.append({'frame':index,'parentDecodedSHA256':parent_hash,'outputs':{'boundary':data},
                             'weight':temporal_weight(index,request['ranges'])})
                if index != 5:
                    file.unlink()  # Only the corrected frame needs downloading.
            receipt = {'version':'face-repair-v1','request':request,'records':rows,'complete':False,'elapsedSeconds':1,
                       'providers':{},'tracking':{},'candidates':[],'canonicalDecoder':CANONICAL_DECODER}
            (output/'receipt.json').write_text(json.dumps(receipt))
            (output/'remote-stopped.json').write_text(json.dumps({'jobId':request['jobId'],'instanceId':1,
                'requestSHA256':canonical_hash(request),'stopped':True}))
            (output/'checkpoint-ready.json').write_text(json.dumps({'version':'face-repair-checkpoints-v1','jobId':request['jobId'],
                'instanceId':1,'requestSHA256':canonical_hash(request),'receiptSHA256':digest(output/'receipt.json'),
                'complete':True,'frames':12,'files':[{'candidate':'boundary','frame':5,**{k:rows[5]['outputs']['boundary'][k] for k in ('sha256','decodedSHA256')}}]}))
            with patch('vast.load',side_effect=AssertionError('Offline assembly must not access a GPU')), \
                 patch('face_repair_worker.initialize',side_effect=AssertionError('Offline assembly must not initialize ML models')):
                result = try_offline(output,request)
            self.assertTrue(result['complete'])
            self.assertEqual(result['assemblyDevice'],'local-CPU')
            self.assertEqual(result['candidates'][0]['changedFrames'],1)
            self.assertTrue((output/'candidate-boundary.mkv').is_file())
            self.assertEqual(result['request'],request)

    def test_checkpoint_frame_order_and_handle_tampering_are_rejected(self):
        from face_repair_worker import verify_records
        request = RepairBindingTests().request()
        output = dict(protectedPixelsExact=True,changedPixels=0)
        row = dict(frame=0,weight=temporal_weight(0,request['ranges']),outputs={'boundary':output,'identity80':output})
        receipt = dict(request=request,records=[row])
        verify_records(receipt,request)
        for field,value in [('frame',1),('weight',.5)]:
            corrupted = copy.deepcopy(receipt)
            corrupted['records'][0][field] = value
            with self.assertRaises(ValueError):
                verify_records(corrupted,request)


if __name__ == '__main__':
    unittest.main()
