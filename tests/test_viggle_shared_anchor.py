"""CPU-only protocol/latent/clock checks. No models or native sampling."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
import uuid
from unittest.mock import patch

import torch
from safetensors.torch import save_file

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('shared_anchor_test', ROOT / 'custom_nodes/character_swap_helpers/shared_anchor.py')
shared = importlib.util.module_from_spec(spec); spec.loader.exec_module(shared)


class SharedAnchorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        self.context = self.root / 'context.safetensors'
        self.frames = torch.stack([torch.full((64, 64, 3), i / 5) for i in range(5)])
        self.ids = {k: str(uuid.uuid4()) for k in ['parent', 'reverse', 'forward', 'prompt']}
        self.meta = {'version': shared.VERSION, 'job_id': self.ids['reverse'], 'parent_job_id': self.ids['parent'],
            'anchor_frame': '10', 'source_sha256': 'a'*64, 'reference_sha256': 'b'*64,
            'branch_source_sha256': 'c'*64, 'width': '64', 'height': '64', 'fps': '24',
            'count': '5', 'reverse_local_start': '0', 'source_count': '11'}
        save_file({'frames': self.frames}, str(self.context), metadata=self.meta)
        self.graph = {'2': {'class_type': 'VHS_LoadVideo', 'inputs': {'video': 'reverse.mkv', 'force_rate':24,'skip_first_frames':0,'select_every_nth':1}},
            '3': {'class_type': 'RecastViggleSource124', 'inputs': {'width':64,'height':64}},
            '4': {'class_type': 'LoadImage', 'inputs': {'image': 'reference.png'}},
            '40': {'class_type':'ViggleAnimateConditioning','inputs':{'length':124}},
            '45': {'class_type':'SwapFinalizeShot','inputs':{'source_count':['3',1],'overlap':0}},
            '48': {'class_type': 'RecastViggleSaveSharedAnchor', 'inputs': {
                **{k: self.meta[k] for k in ['job_id', 'parent_job_id', 'source_sha256', 'reference_sha256', 'branch_source_sha256']},
                'anchor_frame': 10, 'images': ['45', 2], 'source_input': 'reverse.mkv', 'reference_input': 'reference.png'}}}
        self.artifact = {'filename': 'context.safetensors', 'subfolder': 'shared', 'type': 'output'}
        self.history = {'prompt': [0, self.ids['prompt'], self.graph], 'status': {'completed': True, 'status_str': 'success',
            'messages': [[name, {'prompt_id': self.ids['prompt']}] for name in ['execution_start', 'execution_success']]},
            'outputs': {'48': {'shared_anchor': [{**self.meta, 'sha256': shared.sha(self.context), 'artifact': self.artifact}]}}}
        self.proof = {'version': shared.VERSION, 'syntheticOnly': False, 'origin': 'saved-native-comfy-history',
            'parentJobID': self.ids['parent'], 'reverseJobID': self.ids['reverse'], 'forwardJobID': self.ids['forward'],
            'sourceSHA256': 'a'*64, 'referenceSHA256': 'b'*64, 'reverseSourceSHA256': 'c'*64, 'forwardSourceSHA256': 'd'*64,
            'reverseFrames': 11, 'anchorFrame': 10, 'width': 64, 'height': 64, 'reversePromptID': self.ids['prompt'],
            'contextSHA256': shared.sha(self.context), 'originArtifact': self.artifact,
            'reverseLocalOrder': [4,3,2,1,0], 'forwardPrefixAbsoluteFrames': [6,7,8,9,10]}
        self.refresh_proof()
        self.expected = {k: self.proof[k] for k in ['parentJobID', 'forwardJobID', 'sourceSHA256', 'referenceSHA256', 'forwardSourceSHA256', 'anchorFrame', 'width', 'height']}
    def tearDown(self): self.temp.cleanup()
    def refresh_proof(self):
        for key, value in [('reverseGraph', self.graph), ('reverseHistory', self.history)]:
            text = json.dumps(value); self.proof[key+'JSON'] = text
            self.proof[key+'SHA256'] = hashlib.sha256(text.encode()).hexdigest()
    def validate(self, proof=None): return shared.validate_proof(json.dumps(proof or self.proof), self.context, self.expected)
    def test_holds_are_context_only_real_count_and_pixels_stay_exact(self):
        actual, count = shared.pad_context(self.frames)
        self.assertEqual(count, 5); self.assertEqual(len(actual), 124)
        self.assertTrue(torch.equal(actual[:5], self.frames))
        self.assertTrue(torch.equal(actual[5:], self.frames[-1:].repeat(119,1,1,1)))
        full = actual.clone(); again, count = shared.pad_context(full)
        self.assertEqual(count,124); self.assertTrue(torch.equal(again,full))
    def test_bad_real_ranges_and_nonfinite_source_are_rejected(self):
        for frames in [self.frames[:4], self.frames.repeat(25,1,1,1), torch.full_like(self.frames,float('nan'))]:
            with self.assertRaises(ValueError): shared.pad_context(frames)
    def test_actual_pixels_are_reordered_not_reverse_native_latents(self):
        self.assertTrue(torch.equal(self.validate(),self.frames.flip(0)))
    def test_relabelled_forward_parent_range_or_marked_synthetic_history_is_rejected(self):
        for key, value in [('parentJobID',str(uuid.uuid4())),('forwardJobID',str(uuid.uuid4())),('reverseLocalOrder',[0,1,2,3,4]),('forwardPrefixAbsoluteFrames',[7,8,9,10,11]),('syntheticOnly',True)]:
            p=copy.deepcopy(self.proof);p[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError): self.validate(p)
        self.history['syntheticOnly']=True;self.refresh_proof()
        with self.assertRaises(ValueError):self.validate()
    def test_changed_context_or_graph_cannot_reuse_old_origin(self):
        self.context.write_bytes(self.context.read_bytes()+b'changed')
        with self.assertRaises(ValueError):self.validate()
    def test_escape_and_symlink_are_rejected(self):
        with self.assertRaises(ValueError):shared.inside(self.root,'../other')
        alias=self.root/'alias.safetensors';alias.symlink_to(self.context)
        with self.assertRaises(ValueError):shared.inside(self.root,alias.name)
    def test_five_pixel_encoding_pins_only_two_video_latents_silent_audio_unpinned(self):
        for name, data in [('forward.mkv',b'forward'),('reference.png',b'ref')]: (self.root/name).write_bytes(data)
        self.expected['forwardSourceSHA256']=self.proof['forwardSourceSHA256']=shared.sha(self.root/'forward.mkv')
        self.expected['referenceSHA256']=self.proof['referenceSHA256']=shared.sha(self.root/'reference.png')
        self.meta['reference_sha256']=self.proof['referenceSHA256'];self.graph['48']['inputs']['reference_sha256']=self.proof['referenceSHA256']
        save_file({'frames':self.frames},str(self.context),metadata=self.meta)
        self.proof['contextSHA256']=shared.sha(self.context)
        self.history['outputs']['48']['shared_anchor'][0].update(self.meta,sha256=self.proof['contextSHA256'])
        self.refresh_proof()
        class Nested:
            is_nested=True
            def __init__(self,parts):self.parts=parts
            def unbind(self):return self.parts
        module=types.ModuleType('comfy');nested=types.ModuleType('comfy.nested_tensor');nested.NestedTensor=Nested;module.nested_tensor=nested
        video=torch.zeros((1,24,37,4,4));audio=torch.zeros((1,32,2,207));seen=[]
        class VAE:
            def encode(_,frames):seen.append(frames.clone());return torch.ones((1,24,2,4,4))
        folder=types.SimpleNamespace(get_input_directory=lambda:str(self.root))
        with patch.dict(sys.modules,{'folder_paths':folder,'comfy':module,'comfy.nested_tensor':nested}):
            result=shared.RecastViggleSharedAnchor().anchor({'samples':Nested((video,audio))},VAE(),self.context.name,json.dumps(self.proof),self.ids['parent'],self.ids['forward'],'a'*64,self.proof['referenceSHA256'],self.proof['forwardSourceSHA256'],'forward.mkv','reference.png',10,64,64)[0]
        v,a=result['samples'].unbind();vm,am=result['noise_mask'].unbind()
        self.assertTrue(torch.equal(seen[0],self.frames.flip(0)))
        self.assertTrue(torch.equal(v[:,:,:2],torch.ones_like(v[:,:,:2])))
        self.assertEqual(torch.count_nonzero(v[:,:,2:]).item(),0)
        self.assertEqual(torch.count_nonzero(vm[:,:,:2]).item(),0)
        self.assertTrue(torch.equal(vm[:,:,2:],torch.ones_like(vm[:,:,2:])))
        self.assertTrue(torch.equal(a,audio));self.assertTrue(torch.equal(am,torch.ones_like(am)))
        self.assertEqual(torch.count_nonzero(video).item(),0)


if __name__=='__main__':unittest.main()
