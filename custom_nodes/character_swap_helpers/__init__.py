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

from .logic import OVERLAP, context_matches, dimensions, padded_length


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


NODE_CLASS_MAPPINGS = {
    "SwapControls": SwapControls,
    "SwapPrepareShot": SwapPrepareShot,
    "SwapFitReference": SwapFitReference,
    "SwapOptionalLoRA": SwapOptionalLoRA,
    "SwapLoadContext": SwapLoadContext,
    "SwapFinalizeShot": SwapFinalizeShot,
    "SwapSaveContext": SwapSaveContext,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "SwapControls": "Shot Settings",
    "SwapPrepareShot": "Prepare Source Window",
    "SwapFitReference": "Fit Reference Without Cropping",
    "SwapOptionalLoRA": "Optional LoRA",
    "SwapLoadContext": "Previous Shot Context",
    "SwapFinalizeShot": "Trim Overlap and Align Audio",
    "SwapSaveContext": "Save Next Shot Context",
}
