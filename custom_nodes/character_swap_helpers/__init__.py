"""Local video bookkeeping and optional LoRAs; generation stays in native ComfyUI."""

import json
import os
import uuid
from pathlib import Path

import torch
import folder_paths
import nodes
from safetensors import safe_open
from safetensors.torch import load_file, save_file

from .logic import OVERLAP, context_matches, dimensions, padded_length, viggle_length


class SwapControls:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "preset": (["fast_6_steps", "undistilled_40_steps"],),
            "width": ("INT", {"default": 480, "min": 32, "max": 2048, "step": 32}),
            "height": ("INT", {"default": 832, "min": 32, "max": 2048, "step": 32}),
            "fps": ("FLOAT", {"default": 16.0, "min": 1.0, "max": 60.0, "step": 1.0}),
            "frame_cap": ("INT", {"default": 81, "min": 5, "max": 81, "step": 1}),
            "skip_frames": ("INT", {"default": 0, "min": 0, "max": 10000000}),
            "seed": ("INT", {"default": 20261024, "min": 0, "max": 0xffffffffffffffff, "control_after_generate": False}),
            "dpo_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.05}),
        }}

    RETURN_TYPES = ("INT", "INT", "FLOAT", "INT", "INT", "INT", "FLOAT", "FLOAT", "FLOAT", "INT")
    RETURN_NAMES = ("width", "height", "fps", "frame_cap", "skip_frames", "steps", "cfg", "speed_lora", "dpo_lora", "seed")
    FUNCTION = "settings"
    CATEGORY = "Character Swap"

    def settings(self, preset, width, height, fps, frame_cap, skip_frames, seed, dpo_strength):
        dimensions(width, height)
        padded_length(frame_cap)
        fast = preset == "fast_6_steps"
        return width, height, fps, frame_cap, skip_frames, 6 if fast else 40, 1.0 if fast else 5.0, 0.8 if fast else 0.0, dpo_strength, seed


def slice_audio(audio, fps, start, count):
    if audio is None:
        return None
    waveform = audio["waveform"]
    if waveform.numel() == 0:
        return None
    rate = int(audio["sample_rate"])
    first = round(start * rate / fps)
    last = round((start + count) * rate / fps)
    selected = waveform[..., first:last]
    if selected.numel() == 0:
        return None
    return {"waveform": selected, "sample_rate": rate}


class SwapPrepareShot:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "width": ("INT", {"default": 480}), "height": ("INT", {"default": 832})}, "optional": {"audio": ("AUDIO",)}}

    RETURN_TYPES = ("IMAGE", "INT", "INT", "AUDIO")
    RETURN_NAMES = ("conditioning_frames", "generation_length", "source_count", "audio")
    FUNCTION = "prepare"
    CATEGORY = "Character Swap"

    def prepare(self, images, width, height, audio=None):
        images = fit_images(images, width, height)
        count = len(images)
        length = padded_length(count)
        if length > count:
            images = torch.cat([images, images[-1:].repeat(length - count, 1, 1, 1)], dim=0)
        return images, length, count, audio


def fit_images(images, width, height):
    dimensions(width, height)
    scale = min(width / images.shape[2], height / images.shape[1])
    resized_width = max(1, round(images.shape[2] * scale))
    resized_height = max(1, round(images.shape[1] * scale))
    resized = torch.nn.functional.interpolate(images.movedim(-1, 1), size=(resized_height, resized_width), mode="bicubic", align_corners=False, antialias=True).movedim(1, -1).clamp(0, 1)
    output = images.new_zeros((len(images), height, width, images.shape[-1]))
    left, top = (width - resized_width) // 2, (height - resized_height) // 2
    output[:, top:top + resized_height, left:left + resized_width] = resized
    return output


class RecastViggleSource:
    """Pad only the generation grid; retain the actual count for exact export."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "width": ("INT", {"default": 480, "min": 32, "max": 2048, "step": 32}), "height": ("INT", {"default": 864, "min": 32, "max": 2048, "step": 32})}}

    RETURN_TYPES = ("IMAGE", "INT", "IMAGE")
    RETURN_NAMES = ("padded_video", "source_count", "source_frame")
    FUNCTION = "prepare"
    CATEGORY = "Character Swap/Viggle"

    def prepare(self, images, width, height):
        images = fit_images(images, width, height)
        count = len(images)
        length = viggle_length(count)
        if length > count:
            images = torch.cat([images, images[-1:].repeat(length - count, 1, 1, 1)])
        return images, count, images[:1]


class SwapFitReference:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"images": ("IMAGE",), "width": ("INT", {"default": 480}), "height": ("INT", {"default": 832})}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "fit"
    CATEGORY = "Character Swap"

    def fit(self, images, width, height):
        return (fit_images(images, width, height),)


class SwapOptionalLoRA:
    def __init__(self):
        self.loader = nodes.LoraLoaderModelOnly()

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "model": ("MODEL",),
            "lora_name": (["None"] + folder_paths.get_filename_list("loras"),),
            "strength_model": ("FLOAT", {"default": 0.8, "min": -5.0, "max": 5.0, "step": 0.05}),
        }}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "apply"
    CATEGORY = "Character Swap"

    def apply(self, model, lora_name, strength_model):
        if lora_name == "None" or strength_model == 0:
            return (model,)
        return self.loader.load_lora_model_only(model, lora_name, strength_model)


def context_file(relative):
    base = Path(folder_paths.get_output_directory()).resolve()
    path = (base / relative).resolve()
    if not path.is_relative_to(base) or path.suffix != ".safetensors":
        raise ValueError("Context must be a .safetensors file inside ComfyUI's output directory.")
    return path


class SwapLoadContext:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "context_path": ("STRING", {"default": "", "multiline": False}),
            "width": ("INT", {"default": 480}),
            "height": ("INT", {"default": 832}),
            "fps": ("FLOAT", {"default": 16.0}),
            "skip_frames": ("INT", {"default": 0}),
        }}

    RETURN_TYPES = ("IMAGE", "INT", "INT")
    RETURN_NAMES = ("previous_frames", "node_offset", "trim_overlap")
    FUNCTION = "load"
    CATEGORY = "Character Swap"

    def load(self, context_path, width, height, fps, skip_frames):
        if not context_path.strip():
            return None, 0, 0
        path = context_file(context_path.strip())
        with safe_open(str(path), framework="pt", device="cpu") as file:
            metadata = file.metadata() or {}
        context_matches(metadata, width, height, fps, skip_frames)
        frames = load_file(str(path), device="cpu")["frames"].float()
        if list(frames.shape) != [OVERLAP, height, width, 3]:
            raise ValueError("Continuation context has invalid frame dimensions.")
        return frames, OVERLAP, OVERLAP

    @classmethod
    def IS_CHANGED(cls, context_path, **kwargs):
        if not context_path.strip():
            return "fresh"
        stat = context_file(context_path.strip()).stat()
        return "%s:%s:%s" % (context_path, stat.st_size, stat.st_mtime_ns)


class SwapFinalizeShot:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",), "source_count": ("INT", {"default": 81}),
            "overlap": ("INT", {"default": 0}), "fps": ("FLOAT", {"default": 16.0}),
        }, "optional": {"audio": ("AUDIO",)}}

    RETURN_TYPES = ("IMAGE", "AUDIO", "IMAGE")
    RETURN_NAMES = ("new_frames", "aligned_audio", "context_frames")
    FUNCTION = "finish"
    CATEGORY = "Character Swap"

    def finish(self, images, source_count, overlap, fps, audio=None):
        if len(images) < source_count or source_count <= overlap:
            raise ValueError("Not enough decoded frames for the source window and overlap.")
        actual = images[:source_count]
        result = actual[overlap:]
        return result, slice_audio(audio, fps, overlap, len(result)), actual


class SwapSaveContext:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",), "fps": ("FLOAT", {"default": 16.0}),
            "skip_frames": ("INT", {"default": 0}),
        }}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("context_path", "continuation_details")
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "Character Swap"

    def save(self, images, fps, skip_frames):
        if len(images) < OVERLAP:
            raise ValueError("Five decoded frames are required to save continuation context.")
        relative = "character_swap/context/%s.safetensors" % uuid.uuid4().hex
        path = context_file(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        metadata = {"width": str(images.shape[2]), "height": str(images.shape[1]),
                    "fps": str(fps), "count": str(OVERLAP),
                    "source_end_frame": str(skip_frames + len(images))}
        temporary = str(path) + ".part"
        save_file({"frames": images[-OVERLAP:].detach().to(device="cpu").contiguous()}, temporary, metadata=metadata)
        os.replace(temporary, path)
        info = {"path": relative, "source_end_frame": skip_frames + len(images),
                "source_count": len(images), "fps": fps}
        return {"ui": {"context": [info], "text": [json.dumps(info)]}, "result": (relative, json.dumps(info, indent=2))}


class RecastViggleSaveContext:
    """Persist exactly the five pixels needed by the next end-aligned window.

    The final window can overlap most of its predecessor. Saving its actual
    start, rather than blindly saving the predecessor's tail, is essential.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "images": ("IMAGE",), "fps": ("FLOAT", {"default": 24.0}),
            "skip_frames": ("INT", {"default": 0, "min": 0}),
            "next_skip_frames": ("INT", {"default": 119, "min": 0}),
            "job_id": ("STRING", {"default": ""}),
        }, "optional": {"version": (["five-frame-v1", "last-frame-v2"], {"default": "five-frame-v1"}), "terminal": ("BOOLEAN", {"default": False})}}

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("context_path", "continuation_details")
    OUTPUT_NODE = True
    FUNCTION = "save"
    CATEGORY = "Character Swap/Viggle"

    def save(self, images, fps, skip_frames, next_skip_frames, job_id, version="five-frame-v1", terminal=False):
        if terminal:
            # A completed final window has no successor to anchor. Its receipt
            # uses the actual count; never fail an exported video while trying
            # to create an unused continuation beyond the source boundary.
            if fps != 24 or not job_id or version not in ("five-frame-v1", "last-frame-v2") or len(images) < 5:
                raise ValueError("The final Viggle receipt requires valid source frames and job metadata.")
            info = {"path": "", "version": version, "job_id": job_id, "terminal": True,
                    "source_end_frame": skip_frames + len(images), "source_count": len(images), "fps": fps}
            return {"ui": {"context": [info], "text": [json.dumps(info)]}, "result": ("", json.dumps(info))}
        offset = next_skip_frames - skip_frames
        if fps != 24 or not job_id or version not in ("five-frame-v1", "last-frame-v2") or not 0 <= offset <= len(images) - 5:
            raise ValueError("Viggle continuation requires an exact five-frame anchor inside the completed source window.")
        frames = images[offset:offset + 5].detach().to(device="cpu", dtype=torch.float32).contiguous()
        if not torch.isfinite(frames).all():
            raise ValueError("Viggle continuation contains non-finite pixels; it has not been saved.")
        relative = "character_swap/viggle/%s.safetensors" % uuid.uuid4().hex
        path = context_file(relative)
        path.parent.mkdir(parents=True, exist_ok=True)
        info = {"path": relative, "version": version, "job_id": job_id,
                "source_end_frame": skip_frames + len(images), "source_count": len(images),
                "source_anchor_frame": next_skip_frames, "width": images.shape[2],
                "height": images.shape[1], "count": 5, "fps": fps}
        tensors = {"frames": frames}
        if version == "last-frame-v2":
            info["reference_source_frame"] = skip_frames + len(images) - 1
            # Normally the anchor already ends at the last accepted frame.
            # A larger final overlap needs that last frame stored separately;
            # using the end of the anchor would pick the wrong appearance time.
            if next_skip_frames + 5 != info["source_end_frame"]:
                tensors["reference_frame"] = images[-1:].detach().to(device="cpu", dtype=torch.float32).contiguous()
                if not torch.isfinite(tensors["reference_frame"]).all():
                    raise ValueError("The previous segment's last frame is not finite.")
        temporary = str(path) + ".part"
        save_file(tensors, temporary, metadata={key: str(value) for key, value in info.items()})
        os.replace(temporary, path)
        info["artifact"] = {"filename": path.name, "subfolder": str(Path(relative).parent), "type": "output"}
        return {"ui": {"context": [info], "text": [json.dumps(info)]}, "result": (relative, json.dumps(info, indent=2))}


def load_viggle_context(context_path, width, height, fps, skip_frames, overlap, job_id, version):
    dimensions(width, height)
    path = context_file(context_path)
    with safe_open(str(path), framework="pt", device="cpu") as file:
        meta = file.metadata() or {}
    expected = {"version": version, "job_id": job_id, "width": str(width),
                "height": str(height), "count": "5", "source_anchor_frame": str(skip_frames),
                "source_end_frame": str(skip_frames + overlap)}
    if version not in ("five-frame-v1", "last-frame-v2") or overlap < 5 or fps != 24 or not job_id or any(meta.get(key) != value for key, value in expected.items()) or float(meta.get("fps", -1)) != fps:
        raise ValueError("Saved Viggle anchor does not match this job, source offset, canvas or frame rate. Nothing was sampled.")
    tensors = load_file(str(path), device="cpu")
    frames = tensors["frames"].float()
    if list(frames.shape) != [5, height, width, 3] or not torch.isfinite(frames).all():
        raise ValueError("Saved Viggle anchor must contain five finite frames at the render dimensions.")
    return meta, tensors, frames


class RecastViggleContextReference:
    """The actual previous accepted frame, independent of overlap length."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "context_path": ("STRING", {"default": ""}),
            "width": ("INT", {"default": 480}), "height": ("INT", {"default": 864}),
            "fps": ("FLOAT", {"default": 24.0}), "skip_frames": ("INT", {"default": 119}),
            "overlap": ("INT", {"default": 5}), "job_id": ("STRING", {"default": ""}),
        }}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "reference"
    CATEGORY = "Character Swap/Viggle"

    def reference(self, context_path, width, height, fps, skip_frames, overlap, job_id):
        meta, tensors, frames = load_viggle_context(context_path, width, height, fps, skip_frames, overlap, job_id, "last-frame-v2")
        if meta.get("reference_source_frame") != str(skip_frames + overlap - 1):
            raise ValueError("The appearance reference is not the previous segment's last accepted frame.")
        reference = frames[-1:] if overlap == 5 else tensors.get("reference_frame")
        if reference is None or list(reference.shape) != [1, height, width, 3] or not torch.isfinite(reference).all():
            raise ValueError("The previous segment's last frame is missing or invalid. The original reference was not substituted.")
        return (reference.float(),)

    @classmethod
    def IS_CHANGED(cls, context_path, **kwargs):
        stat = context_file(context_path).stat()
        return "%s:%s:%s" % (context_path, stat.st_size, stat.st_mtime_ns)


class RecastViggleAnchor:
    """Use the pinned upstream five-frame/two-latent anchor with core sampling.

    Only the first two video latents are pinned. Silent audio remains unpinned;
    original audio is restored during local assembly. Never reinterpret Wan
    context, a different job, or the wrong temporal offset as an H3 anchor.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "latent": ("LATENT",), "vae": ("VAE",),
            "context_path": ("STRING", {"default": ""}),
            "width": ("INT", {"default": 480}), "height": ("INT", {"default": 864}),
            "fps": ("FLOAT", {"default": 24.0}), "skip_frames": ("INT", {"default": 119}),
            "overlap": ("INT", {"default": 5}), "job_id": ("STRING", {"default": ""}),
        }, "optional": {"context_version": (["five-frame-v1", "last-frame-v2"], {"default": "five-frame-v1"})}}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "anchor"
    CATEGORY = "Character Swap/Viggle"

    def anchor(self, latent, vae, context_path, width, height, fps, skip_frames, overlap, job_id, context_version="five-frame-v1"):
        import comfy.nested_tensor
        _, _, frames = load_viggle_context(context_path, width, height, fps, skip_frames, overlap, job_id, context_version)
        samples = latent["samples"]
        if not samples.is_nested:
            raise ValueError("Viggle continuation requires the native H3 video/audio latent.")
        video, audio = (tensor.clone() for tensor in samples.unbind())
        anchor = vae.encode(frames)
        if tuple(anchor.shape) != (video.shape[0], video.shape[1], 2, video.shape[3], video.shape[4]) or not torch.isfinite(anchor).all():
            raise ValueError("The H3 VAE must encode the five-frame anchor into two finite video latents.")
        video[:, :, :2] = anchor.to(video)
        video_mask = video.new_ones((1, 1, video.shape[2], video.shape[3], video.shape[4]))
        video_mask[:, :, :2] = 0
        audio_mask = audio.new_ones((1, 1, 1, audio.shape[-1]))
        return ({**latent, "samples": comfy.nested_tensor.NestedTensor((video, audio)),
                 "noise_mask": comfy.nested_tensor.NestedTensor((video_mask, audio_mask))},)

    @classmethod
    def IS_CHANGED(cls, context_path, **kwargs):
        stat = context_file(context_path).stat()
        return "%s:%s:%s" % (context_path, stat.st_size, stat.st_mtime_ns)


NODE_CLASS_MAPPINGS = {
    "RecastViggleSource": RecastViggleSource,
    "RecastViggleContextReference": RecastViggleContextReference,
    "RecastViggleAnchor": RecastViggleAnchor,
    "RecastViggleSaveContext": RecastViggleSaveContext,
    "SwapControls": SwapControls,
    "SwapPrepareShot": SwapPrepareShot,
    "SwapFitReference": SwapFitReference,
    "SwapOptionalLoRA": SwapOptionalLoRA,
    "SwapLoadContext": SwapLoadContext,
    "SwapFinalizeShot": SwapFinalizeShot,
    "SwapSaveContext": SwapSaveContext,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "RecastViggleSource": "Prepare Viggle Source and Anchor Frame",
    "RecastViggleContextReference": "Previous Segment Last Frame Reference",
    "RecastViggleAnchor": "Restore Exact Viggle Five-Frame Anchor",
    "RecastViggleSaveContext": "Save Next Viggle Anchor and Receipt",
    "SwapControls": "Shot Settings",
    "SwapPrepareShot": "Prepare Source Window",
    "SwapFitReference": "Fit Reference Without Cropping",
    "SwapOptionalLoRA": "Optional LoRA",
    "SwapLoadContext": "Previous Shot Context",
    "SwapFinalizeShot": "Trim Overlap and Align Audio",
    "SwapSaveContext": "Save Next Shot Context",
}
