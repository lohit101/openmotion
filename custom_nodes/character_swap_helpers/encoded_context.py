"""Versioned H3 continuation that carries every accepted overlap latent.

These are VAE encodings of the preceding raw decoded frames, not a claim to
recover the preceding sampler's native latents. Legacy five-frame nodes remain
unchanged. The compact checkpoint keeps one exact raw appearance frame.
"""
import json
import os
from pathlib import Path
import uuid

import torch
from safetensors import safe_open
from safetensors.torch import load_file, save_file

VERSION = "encoded-overlap-v3"


def context_file(relative):
    import folder_paths
    base = Path(folder_paths.get_output_directory()).resolve()
    path = (base / relative).resolve()
    if not path.is_relative_to(base) or path.suffix != ".safetensors":
        raise ValueError("Context must be a .safetensors file inside ComfyUI's output directory.")
    return path


def carry_count(overlap):
    if type(overlap) is not int or not 5 <= overlap <= 124 or (overlap - 5) % 17:
        raise ValueError("H3 continuation needs a phase-aligned 17k+5 overlap.")
    return ((overlap - 5) // 17) * 5 + 2


def validate_request(width, height, fps, skip_frames, overlap, job_id):
    if any(type(v) is not int or v < 32 or v % 32 for v in (width, height)):
        raise ValueError("H3 continuation dimensions must be positive multiples of 32.")
    if fps != 24 or type(skip_frames) is not int or skip_frames < 0 or skip_frames % 17 or not job_id:
        raise ValueError("H3 continuation requires the exact job, 24 fps and temporal phase.")
    return carry_count(overlap)


def load_context(context_path, width, height, fps, skip_frames, overlap, job_id):
    count = validate_request(width, height, fps, skip_frames, overlap, job_id)
    path = context_file(context_path)
    expected = {"version": VERSION, "job_id": job_id, "width": str(width), "height": str(height),
                "count": "1", "fps": str(float(fps)), "source_anchor_frame": str(skip_frames),
                "source_end_frame": str(skip_frames + overlap), "overlap": str(overlap),
                "encoded_count": str(count), "reference_source_frame": str(skip_frames + overlap - 1)}
    with safe_open(str(path), framework="pt", device="cpu") as file:
        meta = file.metadata() or {}
    if any(meta.get(key) != value for key, value in expected.items()):
        raise ValueError("Encoded overlap does not match this job, source range, phase or canvas. Nothing was sampled.")
    try:
        source_count = int(meta.get("source_count", "0"))
        previous_start = skip_frames + overlap - source_count
        if not overlap <= source_count <= 124 or previous_start < 0 or previous_start % 17:
            raise ValueError
    except (TypeError, ValueError):
        raise ValueError("Encoded overlap has an invalid preceding source window.") from None
    tensors = load_file(str(path), device="cpu")
    reference, encoded = tensors.get("reference_frame"), tensors.get("encoded_overlap")
    if reference is None or reference.dtype != torch.float32 or list(reference.shape) != [1, height, width, 3] or not torch.isfinite(reference).all():
        raise ValueError("The exact previous raw appearance frame is missing or invalid.")
    if encoded is None or tuple(encoded.shape) != (1, 24, count, height // 16, width // 16) or not encoded.is_floating_point() or not torch.isfinite(encoded).all():
        raise ValueError("The saved complete H3 overlap is missing or invalid.")
    return meta, reference, encoded


class RecastViggleEncodedReference:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"context_path": ("STRING", {"default": ""}), "width": ("INT", {"default": 480}),
                             "height": ("INT", {"default": 864}), "fps": ("FLOAT", {"default": 24.0}),
                             "skip_frames": ("INT", {"default": 119}), "overlap": ("INT", {"default": 5}),
                             "job_id": ("STRING", {"default": ""})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "reference"
    CATEGORY = "Character Swap/Viggle"

    def reference(self, context_path, width, height, fps, skip_frames, overlap, job_id):
        _, reference, _ = load_context(context_path, width, height, fps, skip_frames, overlap, job_id)
        return (reference,)

    @classmethod
    def IS_CHANGED(cls, context_path, **kwargs):
        stat = context_file(context_path).stat()
        return "%s:%s:%s" % (context_path, stat.st_size, stat.st_mtime_ns)


class RecastViggleEncodedAnchor(RecastViggleEncodedReference):
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"latent": ("LATENT",), **super().INPUT_TYPES()["required"]}}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "anchor"

    def anchor(self, latent, context_path, width, height, fps, skip_frames, overlap, job_id):
        import comfy.nested_tensor
        _, _, encoded = load_context(context_path, width, height, fps, skip_frames, overlap, job_id)
        samples = latent["samples"]
        if not samples.is_nested:
            raise ValueError("Complete-overlap continuation requires native H3 video/audio samples.")
        video, audio = (tensor.clone() for tensor in samples.unbind())
        count = encoded.shape[2]
        if video.ndim != 5 or tuple(video.shape[:2] + video.shape[3:]) != (1, 24, height // 16, width // 16) or count >= video.shape[2] or audio.ndim != 4 or tuple(audio.shape[:3]) != (1, 32, 2) or not torch.isfinite(video).all() or not torch.isfinite(audio).all():
            raise ValueError("The continuation canvas/latent range does not match the next H3 window.")
        video[:, :, :count] = encoded.to(video)
        video_mask = video.new_ones((1, 1, video.shape[2], video.shape[3], video.shape[4]))
        video_mask[:, :, :count] = 0
        # The chronological original soundtrack is restored during assembly.
        # As in the pinned upstream loop, H3's silent audio remains unpinned.
        audio_mask = audio.new_ones((1, 1, 1, audio.shape[-1]))
        return ({**latent, "samples": comfy.nested_tensor.NestedTensor((video, audio)),
                 "noise_mask": comfy.nested_tensor.NestedTensor((video_mask, audio_mask))},)


class RecastViggleSaveEncodedContext:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "vae": ("VAE",), "fps": ("FLOAT", {"default": 24.0}),
                             "skip_frames": ("INT", {"default": 0}), "next_skip_frames": ("INT", {"default": 119}),
                             "job_id": ("STRING", {"default": ""})},
                "optional": {"terminal": ("BOOLEAN", {"default": False})}}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("context_path", "continuation_details")
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "Character Swap/Viggle"

    def save(self, images, vae, fps, skip_frames, next_skip_frames, job_id, terminal=False):
        if images.ndim != 4 or images.shape[-1] != 3 or not 5 <= len(images) <= 124 or not torch.isfinite(images).all():
            raise ValueError("Encoded continuation requires 5–124 finite raw source frames.")
        height, width = images.shape[1:3]
        validate_request(width, height, fps, skip_frames, 5, job_id)
        info = {"path": "", "version": VERSION, "job_id": job_id, "source_end_frame": skip_frames + len(images),
                "source_count": len(images), "fps": float(fps)}
        if terminal:
            info["terminal"] = True
        else:
            offset = next_skip_frames - skip_frames
            overlap = len(images) - offset
            if type(offset) is not int or offset <= 0 or offset % 17:
                raise ValueError("The next H3 overlap does not begin on the saved source phase.")
            count = validate_request(width, height, fps, next_skip_frames, overlap, job_id)
            encoded = vae.encode(images[offset:])
            if tuple(encoded.shape) != (1, 24, count, height // 16, width // 16) or not torch.isfinite(encoded).all():
                raise ValueError("The H3 VAE did not encode the complete finite overlap.")
            relative = "character_swap/viggle/%s.safetensors" % uuid.uuid4().hex
            path = context_file(relative)
            path.parent.mkdir(parents=True, exist_ok=True)
            info.update(path=relative, width=width, height=height, count=1, overlap=overlap, encoded_count=count,
                        source_anchor_frame=next_skip_frames, reference_source_frame=skip_frames + len(images) - 1)
            tensors = {"reference_frame": images[-1:].detach().to(device="cpu", dtype=torch.float32).contiguous(),
                       "encoded_overlap": encoded.detach().to(device="cpu").contiguous()}
            temporary = str(path) + ".part"
            save_file(tensors, temporary, metadata={key: str(value) for key, value in info.items()})
            os.replace(temporary, path)
            info["artifact"] = {"filename": path.name, "subfolder": str(Path(relative).parent), "type": "output"}
        return {"ui": {"context": [info], "text": [json.dumps(info)]}, "result": (info["path"], json.dumps(info))}
