import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import torch
from safetensors.torch import load_file, save_file
from safetensors import safe_open

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('encoded_context_test',ROOT/'custom_nodes/character_swap_helpers/encoded_context.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Nested:
    is_nested=True
    def __init__(self,tensors):self.tensors=tuple(tensors)
    def unbind(self):return self.tensors
class VAE:
    def encode(self,images):
        self.received=images.clone()
        return torch.arange(m.carry_count(len(images)),dtype=torch.float32)[None,None,:,None,None].expand(1,24,-1,6,4).contiguous()
class EncodedContextTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)
        self.comfy=types.ModuleType('comfy');self.comfy.nested_tensor=types.ModuleType('comfy.nested_tensor');self.comfy.nested_tensor.NestedTensor=Nested
        self.patch=patch.dict(sys.modules,{'comfy':self.comfy,'comfy.nested_tensor':self.comfy.nested_tensor,'folder_paths':types.SimpleNamespace(get_output_directory=lambda:str(self.base))});self.patch.start()
        self.images=torch.rand(124,96,64,3);self.vae=VAE()
    def tearDown(self):self.patch.stop();self.temp.cleanup()
    def save(self,next_skip=51):return m.RecastViggleSaveEncodedContext().save(self.images,self.vae,24,0,next_skip,'job')['ui']['context'][0]
    def test_complete_large_overlap_is_pinned_and_input_untouched(self):
        info=self.save();self.assertEqual(info['encoded_count'],22);self.assertEqual(info['overlap'],73);self.assertTrue(torch.equal(self.vae.received,self.images[51:]))
        reference=m.RecastViggleEncodedReference().reference(info['path'],64,96,24,51,73,'job')[0];self.assertTrue(torch.equal(reference,self.images[-1:]))
        latent={'samples':Nested((torch.randn(1,24,37,6,4),torch.randn(1,32,2,207))),'extra':'retain'};before=latent['samples'].unbind()[0].clone();audio=latent['samples'].unbind()[1].clone()
        result=m.RecastViggleEncodedAnchor().anchor(latent,info['path'],64,96,24,51,73,'job')[0];video,returned_audio=result['samples'].unbind();vm,am=result['noise_mask'].unbind()
        self.assertTrue(torch.equal(video[:,:,:22],self.vae.encode(self.images[51:])));self.assertTrue(torch.equal(video[:,:,22:],before[:,:,22:]));self.assertEqual(vm[:,:,:22].count_nonzero(),0);self.assertTrue((vm[:,:,22:]==1).all());self.assertTrue((am==1).all());self.assertTrue(torch.equal(audio,returned_audio));self.assertTrue(torch.equal(before,latent['samples'].unbind()[0]));self.assertEqual(result['extra'],'retain')
    def test_normal_five_frame_overlap_has_two_latents_and_exact_appearance(self):
        info=self.save(119);self.assertEqual(info['encoded_count'],2);self.assertEqual(info['overlap'],5);self.assertTrue(torch.equal(self.vae.received,self.images[119:]))
        _,ref,encoded=m.load_context(info['path'],64,96,24,119,5,'job');self.assertTrue(torch.equal(ref,self.images[-1:]));self.assertEqual(encoded.shape[2],2)
    def test_terminal_receipt_does_not_encode_or_write_unused_checkpoint(self):
        class NoEncode:
            def encode(self,images):raise AssertionError('Unused final anchor encoded')
        info=m.RecastViggleSaveEncodedContext().save(self.images[:121],NoEncode(),24,238,355,'job',True)['ui']['context'][0]
        self.assertTrue(info['terminal']);self.assertEqual(info['source_end_frame'],359);self.assertFalse(info['path']);self.assertFalse(list(self.base.rglob('*.safetensors')))
    def test_wrong_job_grid_range_version_and_shape_are_rejected(self):
        info=self.save();file=m.context_file(info['path'])
        for width,height,fps,skip,overlap,job in[(64,96,24,51,73,'other'),(64,96,24,68,73,'job'),(64,96,30,51,73,'job'),(64,96,24,51,72,'job'),(96,96,24,51,73,'job')]:
            with self.assertRaises(ValueError):m.load_context(info['path'],width,height,fps,skip,overlap,job)
        tensors=load_file(file)
        with safe_open(file,framework='pt')as f:meta=f.metadata()
        save_file(tensors,file,metadata={**meta,'version':'last-frame-v2'})
        with self.assertRaisesRegex(ValueError,'does not match'):m.load_context(info['path'],64,96,24,51,73,'job')
        save_file({**tensors,'encoded_overlap':tensors['encoded_overlap'][:,:,:2].contiguous()},file,metadata=meta)
        with self.assertRaisesRegex(ValueError,'overlap is missing'):m.load_context(info['path'],64,96,24,51,73,'job')
    def test_bad_vae_and_unsafe_path_never_create_valid_receipts(self):
        self.vae.encode=lambda images:torch.full((1,24,22,6,4),float('nan'))
        with self.assertRaisesRegex(ValueError,'finite overlap'):self.save()
        with self.assertRaisesRegex(ValueError,'inside ComfyUI'):m.context_file('../escape.safetensors')
        with self.assertRaisesRegex(ValueError,'phase'):self.save(52)
        self.assertFalse(list(self.base.rglob('*.safetensors')))

if __name__=='__main__':unittest.main()
