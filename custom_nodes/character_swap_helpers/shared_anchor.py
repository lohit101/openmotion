"""Versioned124-position conditioning and explicit cross-branch pixel lineage.

Historical source/anchor nodes remain unchanged. Shared pixels are re-encoded
chronologically at a new local origin; reverse native latents are never flipped.
"""
import hashlib
import json
import os
from pathlib import Path
import uuid

import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file

VERSION = 'shared-anchor-v2'


def sha(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 ** 2), b''): h.update(block)
    return h.hexdigest()


def inside(root, relative):
    p = Path(relative)
    if p.is_absolute() or '..' in p.parts or not relative:
        raise ValueError('Shared anchor paths must remain relative to the declared Comfy directory.')
    candidate = Path(root) / p
    result = candidate.resolve()
    if candidate.is_symlink() or any((Path(root) / parent).is_symlink() for parent in p.parents) or not result.is_relative_to(Path(root).resolve()) or not result.is_file():
        raise ValueError('The bound shared anchor/input is missing or unsafe.')
    return result


def pad_context(images):
    if images.ndim != 4 or images.shape[-1] != 3 or not 5 <= len(images) <= 124 or not torch.isfinite(images).all():
        raise ValueError('Context124 requires5–124 finite real source frames.')
    count = len(images)
    if count < 124: images = torch.cat([images, images[-1:].repeat(124 - count, 1, 1, 1)])
    return images, count


class RecastViggleSource124:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'width': ('INT', {'default': 480, 'min': 32, 'step': 32}),
                             'height': ('INT', {'default': 864, 'min': 32, 'step': 32})}}
    RETURN_TYPES = ('IMAGE', 'INT', 'IMAGE')
    RETURN_NAMES = ('context124', 'real_source_count', 'source_frame')
    FUNCTION = 'prepare'
    CATEGORY = 'Character Swap/Viggle'
    def prepare(self, images, width, height):
        from . import fit_images
        fitted = fit_images(images, width, height)
        context, count = pad_context(fitted)
        return context, count, fitted[:1]


class RecastViggleSaveSharedAnchor:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'job_id': ('STRING',), 'parent_job_id': ('STRING',),
            'anchor_frame': ('INT', {'min': 4}), 'source_sha256': ('STRING',), 'reference_sha256': ('STRING',),
            'branch_source_sha256': ('STRING',), 'source_input': ('STRING',), 'reference_input': ('STRING',)}}
    RETURN_TYPES = ('STRING',)
    FUNCTION = 'save'
    OUTPUT_NODE = True
    CATEGORY = 'Character Swap/Viggle'
    def save(self, images, job_id, parent_job_id, anchor_frame, source_sha256, reference_sha256,
             branch_source_sha256, source_input, reference_input):
        import folder_paths
        uuid.UUID(job_id); uuid.UUID(parent_job_id)
        if anchor_frame < 4 or images.ndim != 4 or not 5 <= len(images) <= min(124, anchor_frame + 1) or images.shape[-1] != 3 or not torch.isfinite(images).all() or images.min() < 0 or images.max() > 1:
            raise ValueError('Shared reverse prefix requires five real finite frames at a valid anchor.')
        if sha(inside(folder_paths.get_input_directory(), source_input)) != branch_source_sha256 or sha(inside(folder_paths.get_input_directory(), reference_input)) != reference_sha256:
            raise ValueError('Shared reverse source/reference input changed.')
        frames = images[:5].detach().to(device='cpu', dtype=torch.float32).contiguous()
        relative = 'character_swap/shared-anchor/%s.safetensors' % uuid.uuid4().hex
        file = Path(folder_paths.get_output_directory()) / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        meta = {'version': VERSION, 'job_id': job_id, 'parent_job_id': parent_job_id,
                'anchor_frame': str(anchor_frame), 'source_sha256': source_sha256,
                'reference_sha256': reference_sha256, 'branch_source_sha256': branch_source_sha256,
                'width': str(images.shape[2]), 'height': str(images.shape[1]), 'fps': '24',
                'count': '5', 'reverse_local_start': '0', 'source_count': str(len(images))}
        temporary = str(file) + '.part'
        save_file({'frames': frames}, temporary, metadata=meta); os.replace(temporary, file)
        info = {**meta, 'path': relative, 'sha256': sha(file),
                'artifact': {'filename': file.name, 'subfolder': str(Path(relative).parent), 'type': 'output'}}
        return {'ui': {'shared_anchor': [info]}, 'result': (relative,)}


def validate_proof(proof_json, context_file, expected):
    p = json.loads(proof_json)
    if p.get('version') != VERSION or p.get('syntheticOnly') is not False or p.get('origin') != 'saved-native-comfy-history':
        raise ValueError('A genuine saved native reverse history is required.')
    for key, value in expected.items():
        if p.get(key) != value: raise ValueError('Shared prefix binding changed: ' + key)
    if sha(context_file) != p['contextSHA256']:
        raise ValueError('The saved reverse pixel context changed.')
    graph_text, history_text = p['reverseGraphJSON'], p['reverseHistoryJSON']
    if hashlib.sha256(graph_text.encode()).hexdigest() != p['reverseGraphSHA256'] or hashlib.sha256(history_text.encode()).hexdigest() != p['reverseHistorySHA256']:
        raise ValueError('Shared prefix native graph/history checksum changed.')
    graph, history = json.loads(graph_text), json.loads(history_text)
    if history.get('syntheticOnly') or history.get('cpuOnly') or history.get('inferencePerformed') is False or not history['status']['completed'] or history['status']['status_str'] != 'success' or history['prompt'][1] != p['reversePromptID'] or history['prompt'][2] != graph:
        raise ValueError('Shared prefix was not produced by that completed native graph.')
    uuid.UUID(p['reversePromptID']); uuid.UUID(p['reverseJobID']); uuid.UUID(p['forwardJobID']); uuid.UUID(p['parentJobID'])
    messages = history['status']['messages']
    if not all(any(m[0] == name and m[1].get('prompt_id') == p['reversePromptID'] for m in messages) for name in ['execution_start', 'execution_success']):
        raise ValueError('Shared reverse history lacks actual native execution observations.')
    node = graph.get('48', {})
    ins = node.get('inputs', {})
    bindings = {'job_id': p['reverseJobID'], 'parent_job_id': p['parentJobID'], 'anchor_frame': p['anchorFrame'],
                'source_sha256': p['sourceSHA256'], 'reference_sha256': p['referenceSHA256'],
                'branch_source_sha256': p['reverseSourceSHA256']}
    if node.get('class_type') != 'RecastViggleSaveSharedAnchor' or ins.get('images') != ['45', 2] or any(ins.get(k) != v for k, v in bindings.items()):
        raise ValueError('The native graph does not bind the real reverse prefix.')
    if graph['3']['class_type'] != 'RecastViggleSource124' or graph['2']['inputs']['video'] != ins['source_input'] or graph['4']['inputs'].get('image') != ins['reference_input']:
        raise ValueError('Reverse conditioning inputs do not match the prefix origin.')
    video = graph['2']['inputs']
    if video.get('force_rate') != 24 or video.get('skip_first_frames') != 0 or video.get('select_every_nth') != 1 or graph['3']['inputs'].get('width') != p['width'] or graph['3']['inputs'].get('height') != p['height'] or graph.get('40', {}).get('inputs', {}).get('length') != 124 or graph.get('45', {}).get('inputs', {}).get('source_count') != ['3', 1] or graph['45']['inputs'].get('overlap') != 0:
        raise ValueError('Reverse native source clock/count/context differs from the shared-prefix contract.')
    info = history['outputs']['48']['shared_anchor'][0]
    if info['sha256'] != p['contextSHA256'] or info['artifact'] != p['originArtifact']:
        raise ValueError('Context was not emitted by this native reverse prompt.')
    with safe_open(str(context_file), framework='pt', device='cpu') as file: meta = file.metadata() or {}
    meta_expected = {**{k: str(v) for k, v in bindings.items()}, 'version': VERSION,
                     'width': str(p['width']), 'height': str(p['height']), 'fps': '24', 'count': '5', 'reverse_local_start': '0'}
    if any(meta.get(k) != v or info.get(k) != v for k, v in meta_expected.items()):
        raise ValueError('Reverse pixel metadata was relabelled or belongs to another canvas/source.')
    if p.get('reverseFrames') != p['anchorFrame'] + 1 or meta.get('source_count') != str(min(124, p['reverseFrames'])) or info.get('source_count') != meta['source_count']:
        raise ValueError('Reverse prefix real range differs from the declared parent anchor.')
    frames = load_file(str(context_file), device='cpu').get('frames')
    if frames is None or frames.dtype != torch.float32 or tuple(frames.shape) != (5, p['height'], p['width'], 3) or not torch.isfinite(frames).all() or frames.min() < 0 or frames.max() > 1:
        raise ValueError('Shared prefix must retain the actual five finite raw reverse frames.')
    if p.get('reverseLocalOrder') != [4, 3, 2, 1, 0] or p.get('forwardPrefixAbsoluteFrames') != list(range(p['anchorFrame'] - 4, p['anchorFrame'] + 1)):
        raise ValueError('Shared chronological range/order differs from the new forward source.')
    return frames.flip(0).contiguous()


class RecastViggleSharedAnchor:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'latent': ('LATENT',), 'vae': ('VAE',), 'context_input': ('STRING',),
            'proof_json': ('STRING',), 'parent_job_id': ('STRING',), 'forward_job_id': ('STRING',),
            'source_sha256': ('STRING',), 'reference_sha256': ('STRING',), 'forward_source_sha256': ('STRING',),
            'forward_source_input': ('STRING',), 'reference_input': ('STRING',),
            'anchor_frame': ('INT',), 'width': ('INT',), 'height': ('INT',)}}
    RETURN_TYPES = ('LATENT',)
    FUNCTION = 'anchor'
    CATEGORY = 'Character Swap/Viggle'
    def anchor(self, latent, vae, context_input, proof_json, parent_job_id, forward_job_id,
               source_sha256, reference_sha256, forward_source_sha256, forward_source_input,
               reference_input, anchor_frame, width, height):
        import folder_paths
        import comfy.nested_tensor
        root = folder_paths.get_input_directory()
        if sha(inside(root, forward_source_input)) != forward_source_sha256 or sha(inside(root, reference_input)) != reference_sha256:
            raise ValueError('Shared forward source/reference input changed.')
        frames = validate_proof(proof_json, inside(root, context_input), {
            'parentJobID': parent_job_id, 'forwardJobID': forward_job_id, 'sourceSHA256': source_sha256,
            'referenceSHA256': reference_sha256, 'forwardSourceSHA256': forward_source_sha256,
            'anchorFrame': anchor_frame, 'width': width, 'height': height})
        if 'noise_mask' in latent or not latent['samples'].is_nested:
            raise ValueError('Only a fresh native H3 video/audio latent may receive the shared prefix.')
        video, audio = latent['samples'].unbind()
        if tuple(video.shape) != (1, 24, 37, height // 16, width // 16) or tuple(audio.shape) != (1, 32, 2, 207):
            raise ValueError('Shared prefix requires the versioned124-position H3 canvas.')
        if not torch.isfinite(video).all() or not torch.isfinite(audio).all():
            raise ValueError('The shared native latent contains nonfinite samples.')
        encoded = vae.encode(frames)
        if tuple(encoded.shape) != (1, 24, 2, height // 16, width // 16) or not torch.isfinite(encoded).all():
            raise ValueError('The chronological five raw pixels must encode into exactly two finite H3 latents.')
        v, a = video.clone(), audio.clone(); v[:, :, :2] = encoded.to(v)
        vm = v.new_ones((1, 1, v.shape[2], v.shape[3], v.shape[4])); vm[:, :, :2] = 0
        am = a.new_ones((1, 1, 1, a.shape[-1]))
        return ({**latent, 'samples': comfy.nested_tensor.NestedTensor((v, a)),
                 'noise_mask': comfy.nested_tensor.NestedTensor((vm, am))},)
    @classmethod
    def IS_CHANGED(cls, context_input, **kwargs):
        import folder_paths
        return sha(inside(folder_paths.get_input_directory(), context_input))
